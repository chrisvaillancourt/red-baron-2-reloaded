/**
 * Bombs (docs/sim.md "Bombs"): the load, the release order, the ballistics shared by the
 * combat system and the bombsight's prediction, blast damage, and per-aircraft counts.
 * Combat (combat.ts) releases, flies and bursts them; this module is pure helpers.
 */
import { Vector3 } from 'three';
import type { AircraftEntity, FlightEnvironment, GroundTargetType } from '../core/types';
import { G } from './atmosphere';

/**
 * Fill the racks for a bombing sortie: `ac.bombs` = the spec's full load, one count per
 * `spec.bombs` store. Returns it, or undefined (and leaves `ac.bombs` unset) for a type
 * without racks. The game layer calls it when it builds a bomber for a sortie that carries
 * bombs; an aircraft whose `bombs` stays unset carries none (and flies that much lighter).
 */
export function loadBombs(ac: AircraftEntity): number[] | undefined {
  const stores = ac.spec.bombs;
  if (!stores?.length) return undefined;
  ac.bombs = stores.map((s) => s.count);
  return ac.bombs;
}

/**
 * Mass (kg) of the spec's full bomb load that is not aboard: released, or never loaded.
 * `performance.massLoaded` includes the full load, so the flight model subtracts this.
 */
export function bombMassNotAboard(ac: AircraftEntity): number {
  const stores = ac.spec.bombs;
  if (!stores?.length) return 0;
  let m = 0;
  for (let i = 0; i < stores.length; i++) m += (stores[i].count - Math.min(stores[i].count, ac.bombs?.[i] ?? 0)) * stores[i].massKg;
  return m;
}

/**
 * The store the next release takes: the heaviest with bombs left (ties to the lower
 * index), or -1 when the racks are empty. Heaviest first keeps the big bomb for the
 * first, best-aimed release, and sheds the most weight soonest.
 */
export function nextBombStore(ac: AircraftEntity): number {
  const stores = ac.spec.bombs;
  if (!stores || !ac.bombs) return -1;
  let best = -1;
  for (let i = 0; i < stores.length; i++) {
    if ((ac.bombs[i] ?? 0) <= 0) continue;
    if (best < 0 || stores[i].massKg > stores[best].massKg) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------

/** Drag coefficient of a finned WWI bomb, on its cross-section. */
export const BOMB_CD = 0.25;

/** Body diameter, m: 0.2 m for a 50 kg bomb, scaling with the cube root of the mass. */
export function bombDiameter(massKg: number): number {
  return 0.2 * Math.cbrt(massKg / 50);
}

/** Quadratic drag constant k (1/m) at air density rho: deceleration = k |v_air| v_air. */
export function bombDragK(massKg: number, rho: number): number {
  const d = bombDiameter(massKg);
  return (0.5 * rho * BOMB_CD * Math.PI * d * d * 0.25) / massKg;
}

const _wind = new Vector3();
const _air = new Vector3();

/**
 * Advance a falling bomb by dt (semi-implicit Euler): gravity plus quadratic drag relative
 * to the air, so the wind drifts it. Combat and `predictBombImpact` both use this.
 */
export function stepBomb(position: Vector3, velocity: Vector3, massKg: number, env: FlightEnvironment, dt: number): void {
  env.windAt(position, _wind);
  _air.copy(velocity).sub(_wind);
  const k = bombDragK(massKg, env.airDensityAt(position.y));
  velocity.addScaledVector(_air, -k * _air.length() * dt);
  velocity.y -= G * dt;
  position.addScaledVector(velocity, dt);
}

const PREDICT_DT = 1 / 60;
const MAX_FALL_S = 120;
const _p = new Vector3();
const _v = new Vector3();
const _prev = new Vector3();

/**
 * Where and when the next bomb (or store `storeIndex`) would burst if released now, from
 * the aircraft's position with its velocity, with the same ballistics as a real release.
 * Integrates at 60 Hz (combat runs at the sim rate; they agree within about a metre).
 * Null when there is nothing to release, or it would not reach the ground in 120 s.
 */
export function predictBombImpact(ac: AircraftEntity, env: FlightEnvironment, storeIndex?: number): { point: Vector3; time: number } | null {
  const i = storeIndex ?? nextBombStore(ac);
  const store = ac.spec.bombs?.[i];
  if (!store) return null;
  _p.copy(ac.state.position);
  _v.copy(ac.state.velocity);
  for (let t = 0; t < MAX_FALL_S; t += PREDICT_DT) {
    _prev.copy(_p);
    stepBomb(_p, _v, store.massKg, env, PREDICT_DT);
    const g = env.groundHeightAt(_p.x, _p.z);
    if (_p.y <= g) {
      const f = groundCrossing(_prev, _p, env.groundHeightAt(_prev.x, _prev.z), g);
      const point = _prev.clone().lerp(_p, f);
      point.y = env.groundHeightAt(point.x, point.z);
      return { point, time: t + f * PREDICT_DT };
    }
  }
  return null;
}

/** Fraction along prev -> p where the path meets the ground (heights gPrev, g below each). */
export function groundCrossing(prev: Vector3, p: Vector3, gPrev: number, g: number): number {
  const a = prev.y - gPrev;
  const b = p.y - g;
  return a <= 0 ? 0 : Math.min(1, Math.max(0, a / (a - b)));
}

// ---------------------------------------------------------------------------
// Blast
// ---------------------------------------------------------------------------

/**
 * Blast against ground targets, by Hopkinson-Cranz scaling: the effect depends on the
 * scaled distance Z = r / W^(1/3) (r in m to the target's nearest face, W the charge in kg,
 * taken as TNT). Inside `kill` the target is destroyed; the damage then falls with the
 * square of the way out to `zero`, beyond which there is none. Soft targets (lorries, tents,
 * guns in the open) go out to about Z 10 (a 20 kg charge: destroyed within 9.5 m, damaged to
 * 27 m); buildings and trains need Z 2.5 (7 m); a dug-in battery Z 2 (5.4 m).
 */
const BLAST: Record<GroundTargetType, { kill: number; zero: number }> = {
  'aa-gun': { kill: 3.5, zero: 10 },
  truck: { kill: 3.5, zero: 10 },
  'tent-hangar': { kill: 3.5, zero: 10 },
  'trench-mg': { kill: 3, zero: 8 },
  hangar: { kill: 2.5, zero: 7 },
  'supply-dump': { kill: 2.5, zero: 7 },
  train: { kill: 2.5, zero: 7 },
  artillery: { kill: 2, zero: 6 },
};

/** Damage 0..1 to a ground target of `type` from a burst `distanceM` from its nearest face. */
export function blastDamage(type: GroundTargetType, distanceM: number, explosiveKg: number): number {
  if (explosiveKg <= 0) return 0;
  const z = Math.max(0, distanceM) / Math.cbrt(explosiveKg);
  const b = BLAST[type];
  if (z <= b.kill) return 1;
  if (z >= b.zero) return 0;
  const f = (b.zero - z) / (b.zero - b.kill);
  return f * f;
}

/** `explosion` event size for a charge: about 1.7 for 20 kg, 3.2 for 150 kg, at most 4. */
export function blastSize(explosiveKg: number): number {
  return Math.min(4, Math.max(0.8, 0.6 * Math.cbrt(explosiveKg)));
}

// ---------------------------------------------------------------------------
// Counts for the mission result
// ---------------------------------------------------------------------------

export interface BombStats {
  /** Bombs this aircraft released, whoever aimed them. */
  dropped: number;
  /** Of those, bombs whose blast damaged at least one ground target of the other side. */
  hits: number;
}

const stats = new WeakMap<AircraftEntity, BombStats>();

/** Bombs released and bomb hits for an aircraft (`MissionResult.bombsDropped` / `bombHits`). */
export function getBombStats(ac: AircraftEntity): BombStats {
  const s = stats.get(ac);
  return s ? { ...s } : { dropped: 0, hits: 0 };
}

/** Combat's bookkeeping. */
export function recordBomb(ac: AircraftEntity, kind: 'dropped' | 'hits'): void {
  let s = stats.get(ac);
  if (!s) stats.set(ac, (s = { dropped: 0, hits: 0 }));
  s[kind]++;
}

