/**
 * Builds the per-frame `HudView` (src/ui/hud/types.ts) from the live flight
 * session. The HUD only ever sees this plain data.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, Entity, GameSettings, GunType } from '../core/types';
import { GUNS } from '../data/aircraft';
import { getCoefficients } from '../sim';
import type { HudCameraView, HudGun, HudScreenPoint, HudTarget, HudThreat, HudView, HudWingman, WingmanStatus } from '../ui/hud/types';
import type { CameraMode } from './cameras';

const tmp = new Vector3();
const tmp2 = new Vector3();

/** Project a world point to normalised screen coords (0..1 from top-left) with an edge angle when off-screen. */
export function toScreen(camera: PerspectiveCamera, world: Vector3): HudScreenPoint {
  tmp.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const behind = tmp.z > 0;
  tmp.applyMatrix4(camera.projectionMatrix);
  let x = tmp.x;
  let y = tmp.y;
  if (behind) {
    x = -x;
    y = -y;
  }
  const onScreen = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  return { x: (x + 1) / 2, y: (1 - y) / 2, onScreen, edgeAngle: onScreen ? undefined : Math.atan2(x, y) };
}

const GUN_NAMES: Record<GunType, string> = { spandau: 'Spandau', parabellum: 'Parabellum', vickers: 'Vickers', lewis: 'Lewis' };

const HUD_VIEW: Record<CameraMode, HudCameraView> = {
  cockpit: 'cockpit',
  chase: 'chase',
  orbit: 'chase',
  padlock: 'padlock',
  flyby: 'flyby',
  target: 'target',
};

export interface HudBuildInput {
  player: AircraftEntity;
  world: WorldQuery;
  camera: PerspectiveCamera;
  settings: GameSettings;
  timeScale: number;
  cameraMode: CameraMode;
  padlockId: number | null;
  padlockObstructed: boolean;
  /** Target explicitly selected by the player (T), if any. */
  targetId: number | null;
  aimDirection: Vector3 | null;
  /** Index of the player's next waypoint (tracked by the session). */
  waypointIndex: number;
  /** Acknowledged wingman orders by entity id. */
  wingmanOrders: ReadonlyMap<number, string>;
  hint: string | null;
}

const AUTO_TARGET_RANGE = 2500;
const THREAT_RANGE = 3000;

function entityPosition(e: Entity): Vector3 {
  return e.kind === 'aircraft' ? e.state.position : e.position;
}

function describeTarget(e: Entity, i: HudBuildInput): HudTarget {
  const p = i.player.state;
  const pos = entityPosition(e);
  const range = pos.distanceTo(p.position);
  const rel = tmp2.copy(pos).sub(p.position).normalize();
  const vel = e.kind === 'aircraft' ? e.state.velocity : null;
  const closure = vel ? -tmp.copy(vel).sub(p.velocity).dot(rel) : p.velocity.dot(rel);
  const screen = toScreen(i.camera, pos);
  if (e.kind === 'aircraft') {
    // Aspect: angle between the target's tail and the line to us (0 = dead astern).
    const tFwd = new Vector3(0, 0, -1).applyQuaternion(e.state.orientation);
    const toUs = rel.clone().negate();
    const aspectDeg = 180 - (Math.acos(Math.max(-1, Math.min(1, tFwd.dot(toUs)))) * 180) / Math.PI;
    const dmg = Math.max(...Object.values(e.damage.zones));
    // Lead point for the fixed guns (relaxed flight model only).
    const muzzle = 800;
    const tof = range / muzzle;
    const leadPos = pos.clone().addScaledVector(e.state.velocity, tof).addScaledVector(p.velocity, -tof * 0.1);
    return {
      name: e.callsign,
      type: e.spec.name,
      kind: 'aircraft',
      friendly: e.side === i.player.side,
      range,
      closure,
      aspectDeg,
      screen,
      damage: dmg,
      isAce: !!e.aceId,
      lead: toScreen(i.camera, leadPos),
    };
  }
  if (e.kind === 'balloon') {
    return { name: 'Observation balloon', type: 'Observation balloon', kind: 'balloon', friendly: e.side === i.player.side, range, closure, screen, damage: 1 - e.health };
  }
  const t = e.type.replace(/-/g, ' ');
  return { name: t[0].toUpperCase() + t.slice(1), type: 'Ground target', kind: 'ground', friendly: e.side === i.player.side, range, closure, screen, damage: 1 - e.health };
}

function pickTarget(i: HudBuildInput): Entity | null {
  const { world, player } = i;
  const alive = (e: Entity | undefined): e is Entity =>
    !!e && (e.kind === 'aircraft' ? e.outcome === null : !e.destroyed);
  const byId = (id: number | null) => (id === null ? undefined : world.getEntity(id));
  const padlocked = byId(i.padlockId);
  if (alive(padlocked)) return padlocked;
  const selected = byId(i.targetId);
  if (alive(selected)) return selected;
  // Auto: nearest live enemy aircraft within range.
  let best: Entity | null = null;
  let bestD = AUTO_TARGET_RANGE;
  for (const a of world.aircraft) {
    if (a.side === player.side || a.outcome !== null) continue;
    const d = a.state.position.distanceTo(player.state.position);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function threats(i: HudBuildInput): HudThreat[] {
  const { player, world, camera } = i;
  const out: HudThreat[] = [];
  const back = new Vector3(0, 0, 1).applyQuaternion(player.state.orientation);
  for (const a of world.aircraft) {
    if (a.side === player.side || a.outcome !== null) continue;
    const d = a.state.position.distanceTo(player.state.position);
    if (d > THREAT_RANGE) continue;
    const s = toScreen(camera, a.state.position);
    const angle = s.onScreen ? Math.atan2(s.x - 0.5, 0.5 - s.y) : s.edgeAngle!;
    const rel = tmp.copy(a.state.position).sub(player.state.position).normalize();
    const behind = rel.dot(back) > 0.5;
    const closing = -tmp2.copy(a.state.velocity).sub(player.state.velocity).dot(rel) > 5;
    out.push({ angle, distance: d, danger: behind && closing && d < 800 });
  }
  return out;
}

function wingmen(i: HudBuildInput): HudWingman[] {
  const { player, world } = i;
  const flight = world.getFlight(player.flightId);
  if (!flight) return [];
  const mates = world.aircraft.filter((a) => a.flightId === player.flightId && a.id !== player.id);
  return mates.map((a) => {
    let status: WingmanStatus = 'ok';
    if (a.outcome === 'landed-friendly') status = 'landed';
    else if (a.outcome !== null) status = 'down';
    else if (Math.max(...Object.values(a.damage.zones)) > 0.4 || a.damage.smoking) status = 'damaged';
    else if (world.aircraft.some((e) => e.side !== a.side && e.outcome === null && e.state.position.distanceTo(a.state.position) < 1200))
      status = 'engaged';
    const last = a.callsign.split(' ').slice(-1)[0] ?? a.callsign;
    const surname = last.startsWith('#') ? a.callsign : last;
    return { name: surname, status, order: i.wingmanOrders.get(a.id) };
  });
}

export function buildHudView(i: HudBuildInput): HudView {
  const { player, world, camera } = i;
  const s = player.state;
  const spec = player.spec;
  const fwd = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
  const heading = Math.atan2(fwd.x, -fwd.z);

  const guns: HudGun[] = player.guns.map((g) => {
    const mount = spec.guns[g.mountIndex];
    const sameType = spec.guns.filter((m) => m.type === mount.type).length;
    const side = sameType > 1 ? (mount.position[0] < 0 ? ' L' : ' R') : '';
    return {
      label: `${GUN_NAMES[mount.type]}${side}`,
      roundsLeft: Number.isFinite(g.roundsLeft) ? g.roundsLeft : mount.rounds,
      capacity: mount.rounds,
      spares: g.sparesLeft,
      jammed: g.jammed,
      jamClearProgress: g.jamClearProgress,
      reloading: g.reloading > 0 ? Math.max(0.01, Math.min(1, 1 - g.reloading / Math.max(0.1, GUNS[mount.type].drumChangeTime))) : 0,
      heat: g.heat,
      observer: mount.mount === 'flexible',
    };
  });

  const target = pickTarget(i);
  const padlocked = i.padlockId !== null ? world.getEntity(i.padlockId) : undefined;

  const flight = world.getFlight(player.flightId);
  let waypoint: HudView['waypoint'] = null;
  if (flight && i.waypointIndex < flight.waypoints.length) {
    const wp = flight.waypoints[i.waypointIndex];
    const pos = new Vector3(wp.x, wp.altitude, wp.z);
    const label = wp.label ?? (wp.action === 'land' ? 'Home' : wp.action === 'patrol' ? 'Patrol' : wp.action.startsWith('attack') ? 'Target' : 'Waypoint');
    waypoint = {
      index: i.waypointIndex,
      total: flight.waypoints.length,
      label,
      distance: Math.hypot(wp.x - s.position.x, wp.z - s.position.z),
      screen: toScreen(camera, pos),
    };
  }

  let mouseAim: HudView['mouseAim'] = null;
  if (i.aimDirection) {
    const aimPt = tmp.copy(i.aimDirection).multiplyScalar(1000).add(camera.position);
    const aim = toScreen(camera, aimPt);
    const nose = toScreen(camera, fwd.clone().multiplyScalar(1000).add(s.position));
    mouseAim = { aim, nose };
  }

  const convergence = s.position.clone().addScaledVector(fwd, 150);

  const d = player.damage;
  return {
    nation: player.nation,
    view: HUD_VIEW[i.cameraMode],
    showInstruments: i.cameraMode !== 'cockpit' && i.cameraMode !== 'padlock',
    airspeed: s.airspeed,
    altitude: s.altitude,
    heightAboveGround: s.heightAboveGround,
    verticalSpeed: s.velocity.y,
    heading,
    gLoad: s.gLoad,
    rpm: s.engineRpm,
    maxRpm: getCoefficients(spec).rpmMax,
    throttle: player.controls.throttle,
    blip: player.controls.blip,
    engineType: spec.performance.engineType,
    fuelL: s.fuelL,
    fuelCapacityL: spec.performance.fuelCapacityL,
    stalled: s.stalled,
    onGround: s.onGround,
    guns,
    damage: {
      engine: d.zones.engine,
      fuselage: d.zones.fuselage,
      leftWing: d.zones.leftWing,
      rightWing: d.zones.rightWing,
      tail: d.zones.tail,
      controls: d.zones.controls,
      fuelTank: d.zones.fuelTank,
      onFire: d.onFire,
      smoking: d.smoking,
      fuelLeak: d.fuelLeak,
      engineDead: d.engineDead,
      pilotWounded: d.pilotWounded,
    },
    target: target ? describeTarget(target, i) : null,
    padlock: {
      active: i.cameraMode === 'padlock' && !!padlocked,
      name: padlocked ? (padlocked.kind === 'aircraft' ? padlocked.callsign : padlocked.kind === 'balloon' ? 'Balloon' : padlocked.type) : undefined,
      lost: i.padlockObstructed,
    },
    threats: threats(i),
    wingmen: wingmen(i),
    waypoint,
    gunReticle: toScreen(camera, convergence),
    mouseAim,
    timeCompression: i.timeScale,
    missionTime: world.time,
    hint: i.hint,
  };
}

/** Advance the player's next-waypoint index when within 1.5 km of it (horizontal). */
export function advanceWaypoint(player: AircraftEntity, world: WorldQuery, index: number): number {
  const flight = world.getFlight(player.flightId);
  if (!flight) return index;
  let i = index;
  while (i < flight.waypoints.length - 1) {
    const wp = flight.waypoints[i];
    if (Math.hypot(wp.x - player.state.position.x, wp.z - player.state.position.z) > 1500) break;
    i++;
  }
  return i;
}
