/**
 * Per-frame HUD data built by the flight session. The HUD implementation
 * (stub or src/ui) only reads this; it never touches entities directly.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { AircraftEntity, GameSettings, GunType, Side } from '../core/types';
import type { WorldQuery } from '../core/interfaces';
import type { CameraMode } from './cameras';

export interface HudGun {
  type: GunType;
  rounds: number;
  spares: number;
  jammed: boolean;
  jamClearProgress: number;
  reloading: boolean;
  empty: boolean;
}

export interface HudContact {
  id: number;
  kind: 'aircraft' | 'balloon' | 'ground';
  label: string;
  side: Side;
  distance: number;
  /** Normalised device coords (-1..1); only meaningful when onScreen. */
  ndcX: number;
  ndcY: number;
  onScreen: boolean;
  /** Screen-plane angle (radians, 0 = up, clockwise) for off-screen arrows. */
  arrowAngle: number;
  isPadlocked: boolean;
  isTarget: boolean;
  destroyed: boolean;
}

export interface HudFrame {
  // Instruments
  airspeedKmh: number;
  altitudeM: number;
  heightAboveGroundM: number;
  headingDeg: number;
  climbRate: number; // m/s
  rpm: number;
  throttle: number;
  fuelL: number;
  fuelCapacityL: number;
  gLoad: number;
  stalled: boolean;
  blip: boolean;
  engineDead: boolean;
  onFire: boolean;
  pilotWounded: boolean;
  guns: HudGun[];
  units: 'metric' | 'imperial';
  // Situation
  missionTime: number;
  timeScale: number;
  paused: boolean;
  cameraMode: CameraMode;
  contacts: HudContact[];
  padlock: HudContact | null;
  /** Padlock target is hidden behind the aircraft structure (wings/nose). */
  padlockObstructed: boolean;
  /** Mouse-aim reticle (NDC) and where the nose points (NDC), when mouse-aim is active. */
  aimReticle: { x: number; y: number } | null;
  noseMarker: { x: number; y: number } | null;
  /** 0..1 grey-out from sustained positive g; negative values = red-out. */
  gEffect: number;
  /** Friendly territory under the player. */
  overFriendly: boolean;
  enemiesNear: boolean;
  showLabels: boolean;
  playerName: string;
  aircraftName: string;
}

const tmp = new Vector3();

export function toNdc(camera: PerspectiveCamera, world: Vector3): { x: number; y: number; onScreen: boolean; angle: number } {
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
  return { x, y, onScreen, angle: Math.atan2(x, y) };
}

export interface HudBuildInput {
  player: AircraftEntity;
  world: WorldQuery;
  camera: PerspectiveCamera;
  settings: GameSettings;
  timeScale: number;
  paused: boolean;
  cameraMode: CameraMode;
  padlockId: number | null;
  padlockObstructed: boolean;
  targetId: number | null;
  aimDirection: Vector3 | null;
  gEffect: number;
  enemiesNear: boolean;
  playerName: string;
}

const MAX_CONTACT_RANGE = 8000;

export function buildHudFrame(i: HudBuildInput): HudFrame {
  const { player, world, camera } = i;
  const s = player.state;
  const units =
    i.settings.units === 'auto' ? (player.nation === 'britain' || player.nation === 'usa' ? 'imperial' : 'metric') : i.settings.units;
  const fwd = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
  const headingRad = Math.atan2(fwd.x, -fwd.z);
  const contacts: HudContact[] = [];
  const add = (id: number, kind: HudContact['kind'], label: string, side: Side, pos: Vector3, destroyed: boolean) => {
    const distance = pos.distanceTo(s.position);
    if (distance > MAX_CONTACT_RANGE && id !== i.padlockId) return;
    const p = toNdc(camera, pos);
    contacts.push({
      id,
      kind,
      label,
      side,
      distance,
      ndcX: p.x,
      ndcY: p.y,
      onScreen: p.onScreen,
      arrowAngle: p.angle,
      isPadlocked: id === i.padlockId,
      isTarget: id === i.targetId,
      destroyed,
    });
  };
  for (const a of world.aircraft) {
    if (a.id === player.id) continue;
    add(a.id, 'aircraft', a.callsign, a.side, a.state.position, a.outcome !== null);
  }
  for (const b of world.balloons) add(b.id, 'balloon', 'Balloon', b.side, b.position, b.destroyed);
  for (const g of world.groundTargets) add(g.id, 'ground', g.type, g.side, g.position, g.destroyed);

  let aimReticle: HudFrame['aimReticle'] = null;
  let noseMarker: HudFrame['noseMarker'] = null;
  if (i.aimDirection) {
    const aimPt = tmp.copy(i.aimDirection).multiplyScalar(1000).add(camera.position);
    const a = toNdc(camera, aimPt);
    aimReticle = { x: a.x, y: a.y };
    const nosePt = fwd.clone().multiplyScalar(1000).add(s.position);
    const n = toNdc(camera, nosePt);
    noseMarker = { x: n.x, y: n.y };
  }

  return {
    airspeedKmh: s.airspeed * 3.6,
    altitudeM: s.altitude,
    heightAboveGroundM: s.heightAboveGround,
    headingDeg: ((headingRad * 180) / Math.PI + 360) % 360,
    climbRate: s.velocity.y,
    rpm: s.engineRpm,
    throttle: player.controls.throttle,
    fuelL: s.fuelL,
    fuelCapacityL: player.spec.performance.fuelCapacityL,
    gLoad: s.gLoad,
    stalled: s.stalled,
    blip: player.controls.blip,
    engineDead: player.damage.engineDead,
    onFire: player.damage.onFire,
    pilotWounded: player.damage.pilotWounded,
    guns: player.guns.map((g) => ({
      type: player.spec.guns[g.mountIndex].type,
      rounds: g.roundsLeft,
      spares: g.sparesLeft,
      jammed: g.jammed,
      jamClearProgress: g.jamClearProgress,
      reloading: g.reloading > 0,
      empty: g.roundsLeft <= 0 && g.sparesLeft <= 0,
    })),
    units,
    missionTime: world.time,
    timeScale: i.timeScale,
    paused: i.paused,
    cameraMode: i.cameraMode,
    contacts,
    padlock: contacts.find((c) => c.isPadlocked) ?? null,
    padlockObstructed: i.padlockObstructed,
    aimReticle,
    noseMarker,
    gEffect: i.gEffect,
    overFriendly: world.sideOfFrontAt(s.position.x, s.position.z) === player.side,
    enemiesNear: i.enemiesNear,
    showLabels: i.settings.realism.targetLabels,
    playerName: i.playerName,
    aircraftName: player.spec.name,
  };
}
