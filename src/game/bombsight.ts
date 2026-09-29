/**
 * The bombsight (docs/bombers.md): the drift between the heading and the ground track, how
 * close a burst must fall to hurt each target, and when to release on a target. Pure logic,
 * tested in Node; the flight session feeds the HUD from it. The impact point itself is the
 * sim's own prediction (src/sim `predictBombImpact`, docs/sim.md "Bombs").
 */
import type { Vector3 } from 'three';
import type { GroundTargetType } from '../core/types';
import { blastDamage, GROUND_TARGET_BOXES } from '../sim';

/** The burst the release cue aims for: one that does at least this much damage. */
export const RELEASE_DAMAGE = 0.25;

/**
 * Radius (m) round a target's centre inside which a burst of `explosiveKg` does at least
 * `RELEASE_DAMAGE`: the sim's blast reach (`blastDamage`, measured from the target's nearest
 * face) plus the half-width of its narrower side. 0 for no charge.
 */
export function releaseRadiusM(type: GroundTargetType, explosiveKg: number): number {
  if (explosiveKg <= 0) return 0;
  // blastDamage falls monotonically with distance: bisect for the RELEASE_DAMAGE edge.
  let lo = 0;
  let hi = 500;
  if (blastDamage(type, lo, explosiveKg) < RELEASE_DAMAGE) return 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (blastDamage(type, mid, explosiveKg) >= RELEASE_DAMAGE) lo = mid;
    else hi = mid;
  }
  const box = GROUND_TARGET_BOXES[type];
  return lo + Math.min(box.hx, box.hz);
}

/** Bombs left aboard, all stores together. */
export function bombsLeft(bombs: readonly number[] | undefined): number {
  return bombs ? bombs.reduce((a, b) => a + b, 0) : 0;
}

/**
 * Angle from the heading to the ground track, radians, positive when the track lies right of
 * the nose (the wind pushing the aircraft right): the drift wire's lean on the sight.
 */
export function driftAngle(headingDir: Vector3, groundVel: Vector3): number {
  if (Math.hypot(groundVel.x, groundVel.z) < 1) return 0;
  const h = Math.atan2(headingDir.x, -headingDir.z);
  const t = Math.atan2(groundVel.x, -groundVel.z);
  return Math.atan2(Math.sin(t - h), Math.cos(t - h));
}

export type ReleaseCue = 'none' | 'run-in' | 'release' | 'past';

export interface ReleaseSolution {
  cue: ReleaseCue;
  targetId: number | null;
  /** Metres from the predicted impact to the target along the ground track (positive: still ahead). */
  alongM: number;
  /** Metres the target lies right (+) or left (-) of the track through the impact point. */
  crossM: number;
  /** Seconds until the impact point reaches the target at this ground speed, or null. */
  timeToRelease: number | null;
}

/** Targets further ahead than this, or further off the track, aren't on the bomb run. */
const RUN_AHEAD_M = 4000;
const RUN_CROSS_M = 400;

/** A target on the bomb run, and how close the burst must fall (`releaseRadiusM`). */
export interface SightTarget {
  id: number;
  position: Vector3;
  radiusM: number;
}

/**
 * The bomb run on the best target: the one nearest the ground track ahead of the predicted
 * impact. `release` while the impact lies within the target's `radiusM`, `past` once it has
 * gone by.
 */
export function releaseSolution(impact: Vector3, groundVel: Vector3, targets: readonly SightTarget[]): ReleaseSolution {
  const gs = Math.hypot(groundVel.x, groundVel.z);
  const none: ReleaseSolution = { cue: 'none', targetId: null, alongM: 0, crossM: 0, timeToRelease: null };
  if (gs < 1) return none;
  const fx = groundVel.x / gs;
  const fz = groundVel.z / gs;
  let best: ReleaseSolution | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const radiusM = t.radiusM;
    const dx = t.position.x - impact.x;
    const dz = t.position.z - impact.z;
    const along = dx * fx + dz * fz;
    // Right of the track: forward (fx, fz) rotated a quarter turn clockwise seen from above is (-fz, fx).
    const cross = dx * -fz + dz * fx;
    if (along > RUN_AHEAD_M || along < -3 * RUN_CROSS_M || Math.abs(cross) > RUN_CROSS_M) continue;
    const score = Math.abs(cross) + Math.max(0, along) * 0.05 + (along < -radiusM ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      const onTarget = Math.abs(along) <= radiusM && Math.abs(cross) <= radiusM;
      best = {
        cue: onTarget ? 'release' : along < -radiusM ? 'past' : 'run-in',
        targetId: t.id,
        alongM: along,
        crossM: cross,
        timeToRelease: along > 0 ? along / gs : 0,
      };
    }
  }
  return best ?? none;
}
