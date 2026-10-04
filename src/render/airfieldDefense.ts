import {
  BoxGeometry, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Quaternion, Scene, Vector3, type Object3D,
} from 'three';
import type { DefenseAssetId, DefenseEvent, DefenseState, DefenseThreat } from '../core/defense';
import type { AircraftVisual, BombView, BulletView, WorldQuery } from '../core/interfaces';
import type { AircraftEntity, AircraftId, GameSettings, GroundTargetEntity, GroundTargetType, Weather } from '../core/types';
import { getAerodrome } from '../data/aerodromes';
import { getAircraft } from '../data/aircraft';
import { composeLivery } from '../data/liveries';
import { createFlightEnvironment } from '../sim/atmosphere';
import { createAircraftEntity } from '../sim/entity';
import { CloudField } from '../world/clouds';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import { createAircraftVisual } from './aircraft/aircraftVisual';
import { preloadAircraftModels } from './aircraft/modelLoader';
import { DefenseAirship } from './defense/airship';
import { BatteryWeapons } from './defense/weapons';
import type { DefensePresentation } from './defensePresentation';
import { releaseGpuResources } from './releaseGpu';
import { createWorldRenderer } from './worldRenderer';

const DATE = '1917-09-01';
const AIRCRAFT: readonly AircraftId[] = ['albatros_dv', 'halberstadt_clii', 'rumpler_civ', 'gotha_gv'];
const WEATHER: Weather = { cloudCover: 0.2, cloudBaseM: 1800, cloudTopM: 2400, wind: [2, 0, 1], visibilityM: 35000, turbulence: 0.08 };
const UP = new Vector3(0, 1, 0);
const ASSET_TYPES: Record<DefenseAssetId, GroundTargetType> = { hq: 'hangar', ammo: 'supply-dump', hospital: 'tent-hangar' };
// Five finite authored raids have <=50 raiders. Retain their damaged instances,
// rather than resetting irreversible damage decals or cloning GLBs every frame.
const MAX_RAIDERS = 64;
const MAX_PROJECTILES = 256;
const MAX_BOMBS = 96;

interface RaiderVisual {
  entity: AircraftEntity | null;
  plane: AircraftVisual | null;
  ship: DefenseAirship | null;
  position: Vector3;
  velocity: Vector3;
  seen: number;
  active: boolean;
  deathLeft: number;
  damage: number;
}
interface AssetVisual {
  entity: GroundTargetEntity;
  intact: Object3D;
  wreck: Object3D;
}
interface TracerSlot extends BulletView {
  id: number; born: number; seen: number; age: number;
}
interface BombSlot extends BombView {
  id: number; born: number; seen: number; age: number; massKg: number; shooterId: number;
}

/** Defense-only adapter: no flight event bus, mission definition or player entity. */
export async function createDefenseScene(canvas: HTMLCanvasElement, settings: GameSettings, signal: AbortSignal): Promise<DefensePresentation> {
  signal.throwIfAborted();
  const field = getAerodrome('bertangles');
  if (!field) throw new Error('Bertangles aerodrome is unavailable');
  const origin = new Vector3(field.x, terrainHeightAt(field.x, field.z), field.z);
  const renderer = createWorldRenderer(canvas, { quality: settings.graphics, date: DATE });
  renderer.setEnvironment(DATE, 'midday', WEATHER);
  const camera = new PerspectiveCamera(settings.fov, 1, renderer.near, renderer.far);
  camera.position.copy(origin);
  camera.position.y += 4;
  const foreground = new Scene();
  foreground.name = 'DefenseForeground';
  foreground.environment = renderer.scene.environment;
  foreground.environmentIntensity = renderer.scene.environmentIntensity;
  const foregroundCamera = new PerspectiveCamera(settings.fov, 1, 0.025, 20);
  const fill = new HemisphereLight(0xc2d6e7, 0x665b3b, 1.3);
  const sun = new DirectionalLight(renderer.sun.color, renderer.sun.intensity);
  foreground.add(fill, sun, sun.target);
  const guns = new BatteryWeapons();
  foreground.add(guns.object);
  const env = createFlightEnvironment(terrainHeightAt, WEATHER);
  const clouds = new CloudField(WEATHER);
  const aircraft: AircraftEntity[] = [];
  const groundTargets: GroundTargetEntity[] = [];
  const raiders = new Map<number, RaiderVisual>();
  const assets = new Map<DefenseAssetId, AssetVisual>();
  const spares = new Map<AircraftId, AircraftVisual>();
  let time = 0;
  let frame = 0;
  let disposed = false;
  let contextLost = false;
  let visualError: unknown;
  let loadingTimer: number | undefined;
  const world: WorldQuery & { readonly player: null } = {
    get time() { return time; },
    date: DATE,
    player: null,
    aircraft,
    balloons: [],
    groundTargets,
    env,
    weather: WEATHER,
    sunDirection: renderer.sunDirection,
    groundHeightAt: terrainHeightAt,
    sideOfFrontAt: (x, z) => sideOfFrontAt(x, z, DATE),
    getFlight: () => undefined,
    getEntity: (id) => aircraft.find((a) => a.id === id) ?? groundTargets.find((g) => g.id === id),
    cloudDensityAt: (x, y, z) => clouds.densityAt(x, y, z, time),
    cloudTransmittance: (a, b) => clouds.transmittance(a.x, a.y, a.z, b.x, b.y, b.z, time),
    nearestCloud: (p, maxR) => {
      const c = clouds.nearestCloud(p.x, p.y, p.z, time, maxR);
      return c ? { position: new Vector3(c.x, c.y, c.z), radius: c.radius } : null;
    },
  };
  const bullets: BulletView[] = [];
  const bombs: BombView[] = [];
  const tracerSlots = new Map<number, TracerSlot>();
  const bombSlots = new Map<number, BombSlot>();
  const freeTracers: TracerSlot[] = Array.from({ length: MAX_PROJECTILES }, () => ({
    id: 0, born: 0, seen: 0, position: new Vector3(), velocity: new Vector3(), tracer: true, side: 'allied', age: 0,
  }));
  const freeBombs: BombSlot[] = Array.from({ length: MAX_BOMBS }, () => ({
    id: 0, born: 0, seen: 0, position: new Vector3(), velocity: new Vector3(), storeIndex: 0, massKg: 50, shooterId: 0, side: 'central', age: 0,
  }));
  const look = new Vector3();
  const pose = new Matrix4();
  const eventPosition = new Vector3();
  const aimOrigin = new Vector3();
  const aimDirection = new Vector3();
  const sunLocal = new Vector3();
  const inverseView = new Quaternion();

  function attachPlane(record: RaiderVisual, visual: AircraftVisual): void {
    if (disposed) { visual.dispose(); return; }
    if (visual.object.userData.fallback) {
      visual.dispose();
      throw new Error(`Defense aircraft GLB unavailable: ${record.entity!.spec.id}`);
    }
    record.plane = visual;
    renderer.scene.add(visual.object);
    visual.update(record.entity!, 0);
    visual.object.visible = record.active;
  }

  function spawn(threat: DefenseThreat): RaiderVisual {
    if (raiders.size >= MAX_RAIDERS) throw new Error('Airfield Defense raider visual capacity exceeded');
    const position = threat.position.clone().add(origin);
    const record: RaiderVisual = {
      entity: null, plane: null, ship: null, position, velocity: threat.velocity.clone(),
      seen: frame, active: true, deathLeft: 0, damage: 0,
    };
    raiders.set(threat.id, record);
    if (threat.aircraftId === 'airship') {
      record.ship = new DefenseAirship();
      record.ship.object.position.copy(position);
      renderer.scene.add(record.ship.object);
    } else {
      const spec = getAircraft(threat.aircraftId);
      const livery = composeLivery({ aircraftId: spec.id, nation: 'germany', date: DATE });
      record.entity = createAircraftEntity({
        id: threat.id, spec, nation: 'germany', livery, controller: 'ai', flightId: 'airfield-raiders',
        start: { x: position.x, z: position.z, altitude: position.y, heading: Math.atan2(threat.velocity.x, -threat.velocity.z), airspeed: threat.velocity.length() }, env,
      });
      // The genuine entity's pose is the rendering/audio mirror of this enemy,
      // not a second flight simulation or an invented player aircraft.
      record.position = record.entity.state.position;
      record.velocity = record.entity.state.velocity;
      const spare = spares.get(spec.id);
      if (spare) {
        spares.delete(spec.id);
        attachPlane(record, spare);
      } else {
        void createAircraftVisual(spec, livery, settings.graphics)
          .then((visual) => attachPlane(record, visual))
          .catch((error: unknown) => { if (!disposed) visualError = error; });
      }
    }
    return record;
  }

  function createAsset(id: DefenseAssetId): AssetVisual {
    const type = ASSET_TYPES[id];
    const intact = renderer.createGroundTargetVisual(type, 'allied');
    const wreck = renderer.createGroundTargetVisual(type, 'allied');
    renderer.setGroundTargetDestroyed(wreck);
    intact.name = `DefenseAsset_${id}`;
    wreck.name = `DefenseAssetWreck_${id}`;
    wreck.visible = false;
    if (id === 'hospital') {
      const white = new MeshStandardMaterial({ color: 0xe4dece, roughness: 0.9 });
      const red = new MeshStandardMaterial({ color: 0xa93028, roughness: 0.8 });
      const panel = new Group();
      const backing = new Mesh(new BoxGeometry(4, 4, 0.07), white);
      panel.add(backing);
      panel.add(new Mesh(new BoxGeometry(0.85, 3.2, 0.09), red));
      panel.add(new Mesh(new BoxGeometry(3.2, 0.85, 0.1), red));
      panel.position.set(0, 4, -7);
      intact.add(panel);
    }
    const entity: GroundTargetEntity = {
      id: -(assets.size + 1), kind: 'ground', type, side: 'allied', position: new Vector3(), heading: 0, health: 1, destroyed: false,
    };
    groundTargets.push(entity);
    renderer.scene.add(intact, wreck);
    const record = { entity, intact, wreck };
    assets.set(id, record);
    return record;
  }

  function syncOrdnance(state: DefenseState): void {
    bullets.length = 0;
    bombs.length = 0;
    for (const projectile of state.projectiles) {
      let slot = tracerSlots.get(projectile.id);
      if (!slot) {
        slot = freeTracers.pop();
        if (!slot) throw new Error('Airfield Defense projectile visual capacity exceeded');
        slot.id = projectile.id;
        slot.born = time;
        tracerSlots.set(slot.id, slot);
      }
      slot.seen = frame;
      slot.position.copy(projectile.position).add(origin);
      slot.velocity.copy(projectile.velocity);
      slot.age = Math.max(1 / 60, time - slot.born);
      bullets.push(slot);
    }
    for (const [id, slot] of tracerSlots) if (slot.seen !== frame) {
      tracerSlots.delete(id);
      freeTracers.push(slot);
    }
    for (const bomb of state.bombs) {
      let slot = bombSlots.get(bomb.id);
      if (!slot) {
        slot = freeBombs.pop();
        if (!slot) throw new Error('Airfield Defense bomb visual capacity exceeded');
        slot.id = bomb.id;
        slot.born = time;
        slot.shooterId = bomb.ownerId;
        slot.massKg = raiders.get(bomb.ownerId)?.entity?.spec.bombs?.[0]?.massKg ?? 50;
        bombSlots.set(slot.id, slot);
      }
      slot.seen = frame;
      slot.position.copy(bomb.position).add(origin);
      slot.velocity.copy(bomb.velocity);
      slot.age = time - slot.born;
      bombs.push(slot);
    }
    for (const [id, slot] of bombSlots) if (slot.seen !== frame) {
      bombSlots.delete(id);
      freeBombs.push(slot);
    }
  }

  function consumeEvent(event: DefenseEvent): void {
    if (event.type === 'raid-complete') return;
    eventPosition.copy(event.position).add(origin);
    switch (event.type) {
      case 'shot':
        guns.fire(event.weapon);
        break;
      case 'hit':
        renderer.effects.sparks(eventPosition, 5);
        renderer.effects.splinters(eventPosition, 3, true);
        break;
      case 'burst':
        renderer.effects.flak(eventPosition, false);
        break;
      case 'bomb-intercepted':
        renderer.effects.explosion(eventPosition, 1.8, false);
        break;
      case 'asset-hit': {
        const explosiveKg = raiders.get(event.ownerId)?.entity?.spec.bombs?.[0]?.explosiveKg ?? 23;
        renderer.handleEvent({ type: 'bomb-exploded', shooterId: event.ownerId, position: eventPosition.clone(), explosiveKg, damagedTargetIds: [] });
        break;
      }
      case 'kill': {
        const record = raiders.get(event.threatId);
        if (record && record.deathLeft === 0) {
          record.deathLeft = 20;
          record.active = true;
          if (record.entity) {
            record.entity.damage.destroyed = true;
            record.entity.damage.onFire = true;
            record.entity.damage.engineDead = true;
            record.entity.damage.structuralFailure = true;
            record.entity.damage.zones.tail = 1;
            record.entity.outcome = 'shot-down';
          }
        }
        if (record?.ship) renderer.effects.hydrogenFireball(eventPosition);
        else renderer.effects.explosion(eventPosition, 2.5, false);
        break;
      }
    }
  }

  const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; };
  const onContextRestored = () => { contextLost = false; };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const presentation: DefensePresentation = {
    camera, world, origin,
    setView(yaw, pitch, focused, weapon, fuzeRange) {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const fov = focused ? settings.fov * 0.55 : settings.fov;
      if (camera.fov !== fov) {
        camera.fov = foregroundCamera.fov = fov;
        camera.updateProjectionMatrix();
        foregroundCamera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
      guns.setAim(weapon, weapon === 'flak' ? fuzeRange : 500);
      aimOrigin.copy(guns.muzzle).applyQuaternion(camera.quaternion);
      aimOrigin.y += 4;
      aimDirection.copy(guns.direction).applyQuaternion(camera.quaternion);
      sunLocal.copy(renderer.sunDirection).applyQuaternion(inverseView.copy(camera.quaternion).invert());
      sun.position.copy(sunLocal).multiplyScalar(10);
    },
    getAim(input) {
      input.origin.copy(aimOrigin);
      input.direction.copy(aimDirection);
    },
    update(state, events, dt) {
      if (disposed) return;
      if (visualError) throw visualError;
      time = state.time;
      env.time = time;
      frame++;
      for (const threat of state.threats) {
        const record = raiders.get(threat.id) ?? spawn(threat);
        record.seen = frame;
        record.active = true;
        record.position.copy(threat.position).add(origin);
        record.velocity.copy(threat.velocity);
        record.damage = Math.max(0, Math.min(1, 1 - threat.health / threat.maxHealth));
        if (record.entity) {
          const ac = record.entity;
          ac.damage.zones.fuselage = record.damage;
          ac.damage.zones.engine = record.damage * 0.8;
          ac.damage.zones.leftWing = record.damage * 0.55;
          ac.damage.zones.rightWing = record.damage * 0.4;
          ac.damage.smoking = record.damage > 0.38;
          ac.damage.onFire = record.damage > 0.78;
        }
      }
      for (const event of events) consumeEvent(event);
      aircraft.length = 0;
      for (const record of raiders.values()) {
        if (record.seen !== frame && record.deathLeft <= 0) record.active = false;
        if (record.active && record.deathLeft > 0) {
          record.deathLeft = Math.max(0, record.deathLeft - dt);
          record.velocity.y -= (record.ship ? 3 : 9.81) * dt;
          record.position.addScaledVector(record.velocity, dt);
          const ground = terrainHeightAt(record.position.x, record.position.z);
          if (record.position.y <= ground + 2) {
            record.position.y = ground + 2;
            renderer.effects.explosion(record.position, record.ship ? 9 : 4, true);
            record.deathLeft = 0;
          }
          if (record.deathLeft === 0) record.active = false;
        }
        const object = record.plane?.object ?? record.ship?.object;
        if (object) object.visible = record.active;
        if (!record.active) continue;
        look.copy(record.position).add(record.velocity);
        pose.lookAt(record.position, look, UP);
        if (record.entity) {
          const ac = record.entity;
          ac.state.orientation.setFromRotationMatrix(pose);
          ac.state.airspeed = record.velocity.length();
          ac.state.altitude = record.position.y;
          ac.state.heightAboveGround = record.position.y - terrainHeightAt(record.position.x, record.position.z);
          ac.state.engineRpm = record.deathLeft > 0 ? 240 : 1250;
          aircraft.push(ac);
          record.plane?.update(ac, dt);
        } else if (record.ship) {
          record.ship.object.position.copy(record.position);
          record.ship.object.quaternion.setFromRotationMatrix(pose);
          record.ship.update(dt, record.damage, record.deathLeft > 0);
          if (record.deathLeft > 0) renderer.effects.balloonFire(record.position, 1, dt);
        }
      }
      for (const asset of state.assets) {
        const visual = assets.get(asset.id) ?? createAsset(asset.id);
        const position = visual.entity.position.copy(asset.position).add(origin);
        position.y = terrainHeightAt(position.x, position.z);
        visual.entity.health = asset.health / asset.maxHealth;
        visual.entity.destroyed = asset.health <= 0;
        visual.intact.position.copy(position);
        visual.wreck.position.copy(position);
        visual.intact.visible = !visual.entity.destroyed;
        visual.wreck.visible = visual.entity.destroyed;
      }
      syncOrdnance(state);
      guns.update(dt);
      if (!contextLost) renderer.update(dt, camera, world, bullets, bombs);
    },
    render() {
      if (disposed || contextLost) return;
      renderer.render(camera);
      const gl = renderer.renderer;
      const autoClear = gl.autoClear;
      gl.autoClear = false;
      gl.clearDepth();
      gl.render(foreground, foregroundCamera);
      gl.autoClear = autoClear;
    },
    resize(width, height) {
      if (disposed) return;
      width = Math.max(1, width);
      height = Math.max(1, height);
      renderer.resize(width, height);
      camera.aspect = foregroundCamera.aspect = width / height;
      camera.updateProjectionMatrix();
      foregroundCamera.updateProjectionMatrix();
    },
    project(local, out) {
      out.copy(local).add(origin).applyMatrix4(camera.matrixWorldInverse);
      if (out.z >= -camera.near) return false;
      out.applyMatrix4(camera.projectionMatrix);
      return out.z >= -1 && out.z <= 1 && Math.abs(out.x) <= 1 && Math.abs(out.y) <= 1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      signal.removeEventListener('abort', cancelLoading);
      clearInterval(loadingTimer);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      // Cached/retired visuals stay attached (hidden), so shared GLB/livery GPU
      // resources are reachable by the production teardown before visual.dispose.
      releaseGpuResources(renderer.renderer, foreground);
      renderer.dispose();
      for (const record of raiders.values()) record.plane?.dispose();
      for (const visual of spares.values()) visual.dispose();
      raiders.clear();
      spares.clear();
      assets.clear();
      tracerSlots.clear();
      bombSlots.clear();
      aircraft.length = groundTargets.length = bullets.length = bombs.length = 0;
      foreground.clear();
      renderer.scene.clear();
    },
  };

  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  function cancelLoading(): void {
    presentation.dispose();
    rejectCancellation(signal.reason);
  }
  signal.addEventListener('abort', cancelLoading, { once: true });

  try {
    presentation.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    presentation.setView(0, 0, false, 'mg', 500);
    renderer.update(0, camera, world, bullets, bombs);
    // Streaming advances behind the loading screen; no simulation clock advances.
    loadingTimer = window.setInterval(() => renderer.update(0, camera, world, bullets, bombs), 30);
    const ready = async () => {
      await preloadAircraftModels(AIRCRAFT);
      signal.throwIfAborted();
      await Promise.all(AIRCRAFT.map(async (id) => {
        const visual = await createAircraftVisual(getAircraft(id), composeLivery({ aircraftId: id, nation: 'germany', date: DATE }), settings.graphics);
        if (disposed) { visual.dispose(); return; }
        if (visual.object.userData.fallback) {
          visual.dispose();
          throw new Error(`Defense aircraft GLB unavailable: ${id}`);
        }
        visual.object.visible = false;
        renderer.scene.add(visual.object);
        spares.set(id, visual);
      }));
      signal.throwIfAborted();
      await renderer.whenReady();
      if (contextLost) throw new Error('WebGL context lost while loading Airfield Defense');
      return presentation;
    };
    return await Promise.race([ready(), cancelled]);
  } catch (error) {
    presentation.dispose();
    throw error;
  } finally {
    clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
}
