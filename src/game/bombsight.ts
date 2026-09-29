/**
 * The bombsight (docs/bombers.md): where a bomb released now would land, the drift between
 * the heading and the ground track, and when to release on a target. Pure logic, tested in
 * Node; the flight session feeds the HUD from it.
 *
 * The ballistics copy track A's bomb model (src/sim, bombers wave 1): quadratic drag relative
 * to the air, dv/dt = g - k|v_air|v_air with v_air = v - wind, k = ½ρ·Cd·A/m, Cd 0.25 and a
 * body diameter of 0.2 m·(m/50 kg)^⅓; the bomb leaves at the aircraft's position and ground
 * velocity. TODO(bombers merge): call src/sim `predictBombImpact(ac, env, storeIndex)` instead,
 * which runs the sim's own integrator, and drop the copy here.
 */
import { Vector3 } from 'three';
import type { AircraftSpec, FlightEnvironment } from '../core/types';

const G = 9.81;
const BOMB_CD = 0.25;

export type BombEnv = Pick<FlightEnvironment, 'groundHeightAt' | 'airDensityAt' | 'windAt'>;

export interface BombPrediction {
  point: Vector3;
  /** Seconds of fall. */
  time: number;
}

/** Drag factor k (1/m) for a bomb of this mass in air of density rho. */
export function bombDragK(massKg: number, rho: number): number {
  const d = 0.2 * Math.cbrt(Math.max(1, massKg) / 50);
  const area = Math.PI * (d / 2) ** 2;
  return (0.5 * rho * BOMB_CD * area) / Math.max(1, massKg);
}

const _p = new Vector3();
const _v = new Vector3();
const _air = new Vector3();
const _wind = new Vector3();
const _prev = new Vector3();

/**
 * Where a bomb released at `pos` with ground velocity `vel` meets the ground, and when.
 * Null when it starts on or under the ground or hasn't landed within `maxTime` seconds.
 */
export function predictBombImpact(pos: Vector3, vel: Vector3, env: BombEnv, massKg: number, opts: { drag?: boolean; dt?: number; maxTime?: number } = {}): BombPrediction | null {
  const drag = opts.drag !== false;
  const dt = opts.dt ?? 0.05;
  const maxTime = opts.maxTime ?? 90;
  _p.copy(pos);
  _v.copy(vel);
  if (_p.y <= env.groundHeightAt(_p.x, _p.z)) return null;
  let t = 0;
  while (t < maxTime) {
    _prev.copy(_p);
    // Semi-implicit Euler; 0.05 s steps keep the error to a metre or so over a 30 s fall.
    if (drag) {
      _air.copy(_v).sub(env.windAt(_p, _wind));
      const k = bombDragK(massKg, env.airDensityAt(_p.y));
      _v.addScaledVector(_air, -k * _air.length() * dt);
    }
    _v.y -= G * dt;
    _p.addScaledVector(_v, dt);
    t += dt;
    const gh = env.groundHeightAt(_p.x, _p.z);
    if (_p.y <= gh) {
      // Interpolate back to the ground crossing within the last step.
      const prevGh = env.groundHeightAt(_prev.x, _prev.z);
      const above = _prev.y - prevGh;
      const below = gh - _p.y;
      const f = above + below > 0 ? above / (above + below) : 1;
      const point = _prev.clone().lerp(_p, f);
      point.y = env.groundHeightAt(point.x, point.z);
      return { point, time: t - dt + f * dt };
    }
  }
  return null;
}

/** The store released next: the heaviest with bombs left, ties to the lower index (track A's order). */
export function nextStoreIndex(spec: AircraftSpec, bombs: readonly number[] | undefined): number | null {
  if (!spec.bombs || !bombs) return null;
  let best: number | null = null;
  spec.bombs.forEach((s, i) => {
    if ((bombs[i] ?? 0) <= 0) return;
    if (best === null || s.massKg > spec.bombs![best].massKg) best = i;
  });
  return best;
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

/**
 * The bomb run on the best target: the one nearest the ground track ahead of the predicted
 * impact. `release` while the impact lies within `radiusM` of it, `past` once it has gone by.
 */
export function releaseSolution(impact: Vector3, groundVel: Vector3, targets: readonly { id: number; position: Vector3 }[], radiusM: number): ReleaseSolution {
  const gs = Math.hypot(groundVel.x, groundVel.z);
  const none: ReleaseSolution = { cue: 'none', targetId: null, alongM: 0, crossM: 0, timeToRelease: null };
  if (gs < 1) return none;
  const fx = groundVel.x / gs;
  const fz = groundVel.z / gs;
  let best: ReleaseSolution | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
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
