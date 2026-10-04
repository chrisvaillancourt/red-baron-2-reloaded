/**
 * Hangar harness (dev/hangar.html): inspect any aircraft with any livery,
 * turntable or cockpit view, propeller/controls/damage animation.
 * Playwright drives it through window.__hangar.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AircraftEntity, AircraftId, CrewStationId, DamageZone, GraphicsQuality, Livery } from '../../../core/types';
import { AIRCRAFT_LIST, getAircraft } from '../../../data/aircraft';
import { composeLivery } from '../../../data/liveries';
import { createAircraftVisual, type AircraftVisualExt } from '../aircraftVisual';
import { defaultLivery } from '../livery';
import { SAMPLE_LIVERIES } from './liveries';

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x9fb7cf);
scene.fog = new Fog(0x9fb7cf, 60, 400);
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

scene.add(new HemisphereLight(0xcfe0ff, 0x5a5236, 0.9));
const sun = new DirectionalLight(0xfff1dc, 2.6);
sun.position.set(12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 }); // the O/400 spans 30 m
scene.add(sun);

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#566b35';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 50},${80 + Math.random() * 50},${30 + Math.random() * 20},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const ground = new Mesh(new PlaneGeometry(800, 800), new MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(9, 4, -9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;

function makeEntity(id: AircraftId, livery: Livery): AircraftEntity {
  const spec = getAircraft(id);
  const zones = Object.fromEntries(['engine', 'fuelTank', 'pilot', 'gunner', 'leftWing', 'rightWing', 'tail', 'fuselage', 'controls', 'guns'].map((z) => [z, 0])) as Record<DamageZone, number>;
  return {
    id: 1, kind: 'aircraft', spec, side: spec.nation === 'germany' ? 'central' : 'allied', nation: spec.nation, livery,
    callsign: spec.name, skill: 'regular', flightId: 'dev', controller: 'none',
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, blip: false, fireGuns: false, clearJam: false },
    state: {
      position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3(),
      airspeed: 0, altitude: 0, heightAboveGround: 0, aoa: 0, sideslip: 0, gLoad: 1, engineRpm: 0,
      fuelL: spec.performance.fuelCapacityL * 0.7, onGround: true, stalled: false,
    },
    guns: spec.guns.map((g, i) => ({ mountIndex: i, roundsLeft: g.rounds, sparesLeft: g.spareDrums, jammed: false, jamClearProgress: 0, heat: 0, cooldown: 0, reloading: 0 })),
    damage: { zones, onFire: false, smoking: false, fuelLeak: false, engineDead: false, pilotWounded: false, pilotKilled: false, structuralFailure: false, destroyed: false, lastAttackerId: null },
    outcome: null,
    bombs: spec.bombs?.map((b) => b.count),
  };
}

const DEFAULTS = {
  quality: 'high' as GraphicsQuality,
  /** Pin simulated readings/poses for matched screenshots; null keeps live animation. */
  animationTime: null as number | null,
  rpm: 0,
  wiggle: false,
  firing: false,
  cockpit: false,
  turntable: true,
  damage: 0,
  flying: false,
  lookDown: 0.12,
  /** Look from a crew station's eye point (stationEyes) instead of orbiting. */
  station: '' as CrewStationId | '',
  /** Aim every station's guns at this azimuth/elevation (deg, FireArc convention); null = stowed. */
  aim: null as [number, number] | null,
  /** Fraction of each bomb store still aboard (1 = full load). */
  bombs: 1,
};
const state = {
  id: 'fokker_dri' as AircraftId,
  livery: 'Richthofen (all red)',
  quality: DEFAULTS.quality,
  animationTime: DEFAULTS.animationTime,
  rpm: 0,
  wiggle: false,
  firing: false,
  cockpit: false,
  turntable: true,
  damage: 0,
  flying: false,
  lookDown: 0.12,
  station: '' as CrewStationId | '',
  aim: null as [number, number] | null,
  bombs: 1,
};
let visual: AircraftVisualExt | null = null;
let entity: AircraftEntity | null = null;
let loadToken = 0;

async function load() {
  const token = ++loadToken;
  const spec = getAircraft(state.id);
  const liv =
    state.livery === 'Default'
      ? defaultLivery(spec)
      : state.livery === 'Factory'
        ? composeLivery({ aircraftId: spec.id, nation: spec.nation, date: spec.retired < '1918-04-15' ? spec.introduced : '1918-06-01' })
        : SAMPLE_LIVERIES[state.livery];
  const v = await createAircraftVisual(spec, liv, state.quality);
  if (token !== loadToken) return v.dispose();
  visual?.dispose();
  visual = v;
  entity = makeEntity(state.id, liv);
  scene.add(v.object);
  v.setCockpitView(state.cockpit);
  applyDamage();
}

function placePose(t: number) {
  if (!visual || !entity) return;
  const { wheelL, skid } = visual.contactPoints;
  if (state.flying) {
    entity.state.position.set(0, 3.5, 0);
    entity.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(t * 0.5) * 0.3);
    return;
  }
  // ground attitude: nose-up angle so wheels and skid both touch the ground
  const dz = skid.z - wheelL.z;
  const dy = skid.y - wheelL.y;
  const pitch = Math.atan2(dy, dz); // positive = nose up
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
  entity.state.orientation.copy(q);
  const w = wheelL.clone().applyQuaternion(q);
  entity.state.position.set(0, -w.y, 0);
}

function applyDamage() {
  if (!entity) return;
  const d = state.damage;
  for (const z of ['leftWing', 'rightWing', 'tail', 'fuselage', 'engine'] as DamageZone[]) entity.damage.zones[z] = d * (z === 'leftWing' ? 1 : 0.6);
  entity.damage.onFire = d > 0.9;
}

// --- UI -------------------------------------------------------------------
const ui = document.getElementById('ui')!;
ui.innerHTML = `
  <label>Aircraft <select id="ac">${AIRCRAFT_LIST.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label>
  <label>Livery <select id="liv"><option>Default</option><option>Factory</option>${Object.keys(SAMPLE_LIVERIES).map((k) => `<option>${k}</option>`).join('')}</select></label>
  <label>Surface quality <select id="quality">${['low', 'medium', 'high', 'ultra'].map((q) => `<option>${q}</option>`).join('')}</select></label>
  <label>RPM <input id="rpm" type="range" min="0" max="1600" value="0"></label>
  <label><input id="wig" type="checkbox"> controls</label>
  <label><input id="fire" type="checkbox"> fire</label>
  <label><input id="cock" type="checkbox"> cockpit</label>
  <label><input id="fly" type="checkbox"> in flight</label>
  <label>Damage <input id="dmg" type="range" min="0" max="1" step="0.05" value="0"></label>
  <button id="brk">Break wing</button>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$<HTMLSelectElement>('ac').value = state.id;
$<HTMLSelectElement>('liv').value = state.livery;
$<HTMLSelectElement>('quality').value = state.quality;
$<HTMLSelectElement>('ac').onchange = (e) => { state.id = (e.target as HTMLSelectElement).value as AircraftId; load(); };
$<HTMLSelectElement>('liv').onchange = (e) => { state.livery = (e.target as HTMLSelectElement).value; load(); };
$<HTMLSelectElement>('quality').onchange = (e) => { state.quality = (e.target as HTMLSelectElement).value as GraphicsQuality; load(); };
$<HTMLInputElement>('rpm').oninput = (e) => { state.rpm = +(e.target as HTMLInputElement).value; };
$<HTMLInputElement>('wig').onchange = (e) => { state.wiggle = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('fire').onchange = (e) => { state.firing = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('cock').onchange = (e) => setCockpit((e.target as HTMLInputElement).checked);
$<HTMLInputElement>('fly').onchange = (e) => { state.flying = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('dmg').oninput = (e) => { state.damage = +(e.target as HTMLInputElement).value; applyDamage(); };
$<HTMLButtonElement>('brk').onclick = () => { if (entity) { entity.damage.zones.leftWing = 1; entity.damage.structuralFailure = true; } };

function setCockpit(on: boolean) {
  state.cockpit = on;
  visual?.setCockpitView(on);
}

let last = performance.now();
let t = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  const poseTime = state.animationTime ?? t;
  if (visual && entity) {
    placePose(poseTime);
    entity.state.engineRpm = state.rpm;
    entity.state.altitude = 1200 + 200 * Math.sin(poseTime * 0.3);
    entity.state.airspeed = 45 + 10 * Math.sin(poseTime * 0.4);
    if (state.wiggle) {
      entity.controls.pitch = Math.sin(poseTime * 1.3);
      entity.controls.roll = Math.sin(poseTime * 1.7);
      entity.controls.yaw = Math.sin(poseTime * 0.9);
    } else entity.controls.pitch = entity.controls.roll = entity.controls.yaw = 0;
    if (state.firing) for (const g of entity.guns) g.roundsLeft = g.roundsLeft > 1 ? g.roundsLeft - 1 : 400;
    entity.bombs = entity.spec.bombs?.map((b) => Math.round(b.count * state.bombs));
    const aim = state.aim ? dirFromAngles(state.aim[0], state.aim[1]) : null;
    if (aim) for (const st of ['nose', 'observer', 'dorsal', 'ventral', 'rear'] as CrewStationId[]) visual.setStationAim(st, aim);
    visual.update(entity, dt);
    const stationEye = state.station ? visual.stationEyes.get(state.station) : undefined;
    visual.setStationView(stationEye ? (state.station as CrewStationId) : null);
    if (stationEye) {
      visual.object.updateMatrixWorld(true);
      const worldEye = visual.object.localToWorld(stationEye.clone());
      camera.position.copy(worldEye);
      const look = (aim ?? new Vector3(0, -0.1, -1)).clone().applyQuaternion(visual.object.quaternion);
      camera.lookAt(worldEye.clone().add(look));
      camera.near = 0.02;
      camera.updateProjectionMatrix();
    } else if (state.cockpit) {
      const eye = visual.eyePoint.clone();
      visual.object.updateMatrixWorld(true);
      const worldEye = visual.object.localToWorld(eye);
      camera.position.copy(worldEye);
      const fwd = new Vector3(0, -state.lookDown, -1).applyQuaternion(visual.object.quaternion);
      camera.lookAt(worldEye.clone().add(fwd));
      camera.near = 0.02;
      camera.updateProjectionMatrix();
    } else {
      if (state.turntable) {
        const r = Math.max(8, entity.spec.geometry.span * 1.1);
        const a = poseTime * 0.25 + 2.3;
        camera.position.set(Math.sin(a) * r, 2.2 + r * 0.18, Math.cos(a) * r);
      }
      controls.target.set(0, visual.object.position.y + 0.3, 0);
      controls.update();
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.domElement.addEventListener('pointerdown', () => { state.turntable = false; });

/** Body-frame unit vector for a FireArc azimuth/elevation (degrees). */
function dirFromAngles(azDeg: number, elDeg: number): Vector3 {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

declare global {
  interface Window { __hangar: unknown }
}
window.__hangar = {
  async show(id: AircraftId, livery = 'Default', opts: Partial<typeof state> = {}) {
    state.id = id;
    state.livery = livery;
    Object.assign(state, DEFAULTS, opts);
    await load();
    $<HTMLSelectElement>('quality').value = state.quality;
    applyDamage();
  },
  setCamera(pos: [number, number, number], target: [number, number, number]) {
    state.turntable = false;
    camera.position.set(...pos);
    controls.target.set(...target);
    controls.update();
  },
  debugBackdrop() {
    ground.visible = false;
    scene.background = new Color(0xff00ff);
    scene.fog = null;
  },
  async set(opts: Partial<typeof state>) {
    const oldQuality = state.quality;
    Object.assign(state, opts);
    if (state.quality !== oldQuality) {
      await load();
      $<HTMLSelectElement>('quality').value = state.quality;
    } else if ('cockpit' in opts) setCockpit(!!opts.cockpit);
    applyDamage();
  },
  breakWing() {
    if (entity) { entity.damage.zones.leftWing = 1; entity.damage.structuralFailure = true; }
  },
  ready: () => !!visual,
  /** Diagnostics for screenshots: draw calls and triangles of the last frame. */
  stats: () => ({
    quality: visual?.object.userData.graphicsQuality ?? state.quality,
    animationTime: state.animationTime,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    eyes: visual ? Object.fromEntries([...visual.stationEyes].map(([k, v]) => [k, v.toArray().map((x) => +x.toFixed(2))])) : {},
    camera: camera.position.toArray().map((x) => +x.toFixed(2)),
  }),
  /** Actual assigned shader features, including per-zone livery materials and cockpit gauges. */
  materials: () => {
    const materials = new Set<MeshStandardMaterial>();
    visual?.object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ((m as MeshStandardMaterial).isMeshStandardMaterial) materials.add(m as MeshStandardMaterial);
      }
    });
    return [...materials].map((m) => ({
      name: m.name,
      type: m.type,
      baseMap: !!m.map,
      roughnessMap: m.roughnessMap?.name ?? null,
      bumpMap: m.bumpMap?.name ?? null,
      clearcoat: 'clearcoat' in m ? m.clearcoat : 0,
    }));
  },
};
load();
