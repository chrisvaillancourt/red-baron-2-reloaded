/**
 * Mission-layer navigation: waypoints, patrol orbits, formation slots,
 * escort stations, RTB and the landing approach.
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, Side } from '../core/types';
import { aerodromesActiveOn, type AerodromeWorld } from '../data/aerodromes';
import { clamp, dirFromHeading, headingOf } from './math';

/**
 * Formation slot offset in the leader's horizontal frame:
 * x = right (m), y = up (m), z = back (m). Slots alternate right/left in a
 * vic, stepping back and slightly up.
 */
export function formationOffset(slot: number, spacing = 45): Vector3 {
  if (slot <= 0) return new Vector3();
  const rank = Math.ceil(slot / 2);
  const side = slot % 2 === 1 ? 1 : -1;
  return new Vector3(side * spacing * rank, 6 * rank, spacing * 0.8 * rank);
}

const _fh = new Vector3();
const _rh = new Vector3();

/** World position of a slot relative to a leader. */
export function slotPosition(leader: AircraftEntity, offset: Vector3, out = new Vector3()): Vector3 {
  const v = leader.state.velocity;
  _fh.set(v.x, 0, v.z);
  if (_fh.lengthSq() < 1) _fh.set(0, 0, -1);
  _fh.normalize();
  _rh.set(-_fh.z, 0, _fh.x); // right of a horizontal forward (fwd -Z -> right +X)
  return out
    .copy(leader.state.position)
    .addScaledVector(_rh, offset.x)
    .addScaledVector(_fh, -offset.z)
    .add(new Vector3(0, offset.y, 0));
}

export interface FormationSteer {
  dir: Vector3;
  speed: number;
  distance: number;
}

/**
 * Formation keeping: pursue the slot projected ahead along the leader's
 * velocity; speed = leader speed + along-track correction.
 */
export function formationSteer(self: AircraftEntity, leader: AircraftEntity, offset: Vector3, maxSpeed: number): FormationSteer {
  const slot = slotPosition(leader, offset);
  const toSlot = slot.clone().sub(self.state.position);
  const distance = toSlot.length();
  const lv = leader.state.velocity;
  const ls = lv.length();
  const lead = clamp(distance / Math.max(ls, 10), 1.5, 6);
  const aim = slot.clone().addScaledVector(lv, lead).sub(self.state.position);
  // Joining up from far below/above: bound the gradient to what a WWI scout can
  // sustain, otherwise the wingman zooms, stalls and falls further behind.
  if (distance > 120) {
    const h = Math.hypot(aim.x, aim.z) || 1;
    const slope = clamp(aim.y / Math.max(h, 150), -0.45, 0.28);
    aim.set((aim.x / h) * 100, slope * 100, (aim.z / h) * 100);
  }
  // Along-track error: positive if the slot is ahead of us.
  const lfwd = lv.clone().normalize();
  const along = toSlot.dot(lfwd);
  let speed = ls + clamp(along * 0.12, -12, 25);
  if (distance > 800) speed = maxSpeed;
  return { dir: aim, speed: clamp(speed, 0, maxSpeed), distance };
}

/** Orbit steering around a centre point at radius (clockwise seen from above). */
export function orbitSteer(self: AircraftEntity, cx: number, cz: number, alt: number, radius: number): Vector3 {
  const p = self.state.position;
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d = Math.hypot(dx, dz) || 1;
  // Tangent for clockwise (heading increasing) orbit.
  const tx = -dz / d;
  const tz = dx / d;
  // Blend radial correction.
  const radial = clamp((d - radius) / radius, -1, 1);
  const dir = new Vector3(tx - (dx / d) * radial * 1.5, 0, tz - (dz / d) * radial * 1.5).normalize();
  dir.y = clamp((alt - p.y) / 400, -0.35, 0.3);
  return dir;
}

export function toPointSteer(self: AircraftEntity, x: number, y: number, z: number): Vector3 {
  const p = self.state.position;
  const h = Math.hypot(x - p.x, z - p.z);
  const dir = new Vector3(x - p.x, 0, z - p.z);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  dir.normalize();
  // Climb/descend gently toward the target altitude; steeper if close.
  dir.y = clamp((y - p.y) / Math.max(h * 0.5, 600), -0.4, 0.35);
  return dir;
}

export function nearestFriendlyAerodrome(side: Side, x: number, z: number, date: string): AerodromeWorld | undefined {
  let best: AerodromeWorld | undefined;
  let bd = Infinity;
  for (const a of aerodromesActiveOn(date)) {
    if (a.side !== side) continue;
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/**
 * A fallback "home" point well inside friendly territory when no aerodrome
 * is known: fly perpendicular to the front toward our side.
 */
export function homeDirection(self: AircraftEntity, world: WorldQuery): Vector3 {
  const p = self.state.position;
  // Probe east/west to find which way is friendly.
  const east = world.sideOfFrontAt(p.x + 15000, p.z);
  const west = world.sideOfFrontAt(p.x - 15000, p.z);
  if (east === self.side && west !== self.side) return new Vector3(1, 0, 0);
  if (west === self.side && east !== self.side) return new Vector3(-1, 0, 0);
  return self.side === 'allied' ? new Vector3(-1, 0, 0) : new Vector3(1, 0, 0);
}

export type LandingStage = 'pattern' | 'approach' | 'final' | 'flare' | 'rollout' | 'stopped';

export interface LandingPlan {
  aerodrome: AerodromeWorld;
  /** Unit horizontal landing direction. */
  dir: Vector3;
  threshold: Vector3;
  approachPoint: Vector3;
}

/** `lane`: lateral offset (m, + = right of the landing direction) so a flight lands abreast. */
export function planLanding(a: AerodromeWorld, groundAt: (x: number, z: number) => number, lane = 0): LandingPlan {
  const dir = dirFromHeading((a.runwayHeadingDeg * Math.PI) / 180);
  const gy = groundAt(a.x, a.z);
  const threshold = new Vector3(a.x, gy, a.z).addScaledVector(dir, -a.runwayLength * 0.45);
  threshold.x += -dir.z * lane;
  threshold.z += dir.x * lane;
  const approachPoint = threshold.clone().addScaledVector(dir, -2500);
  approachPoint.y = gy + 220;
  return { aerodrome: a, dir, threshold, approachPoint };
}

export { headingOf };
