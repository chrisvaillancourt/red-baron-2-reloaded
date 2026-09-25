/**
 * Tactical character: how a pilot sets up and chooses a fight, from skill and (for named
 * aces) the historical signature in src/data/aces.ts. Pure functions and data; the
 * controller (controller.ts) flies it.
 *
 * - **Energy tactics by matchup.** A pilot whose wing loading is well above his target's
 *   (Albatros D.V 44 against a Camel's 31 kg/m²) can't win a turning fight, so he flies
 *   boom-and-zoom: gain height, dive, one burst, zoom away, repeat. Static energy types
 *   (SPAD, S.E.5a, D.VII...) do the same against anyone.
 * - **Positioning.** Before an attack, a pilot with patience climbs for a height advantage
 *   and, if he uses the sun, moves to where the target must look into it.
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity } from '../core/types';
import type { AceTactics } from '../data/aces';
import { getAce } from '../data/aces';
import { clamp, lerp } from './math';

/**
 * Switches for A/B soaks (set from env in the soak tests; never changed in the game).
 * Each defaults to what measured best.
 */
export const TACTICS_FLAGS = {
  /** Out-turned pilots (wing loading >= OUT_TURNED_RATIO x target's) fly boom-and-zoom. */
  boomZoomOutTurned: true,
  /** Boom-and-zoom only while above the target (no climbing for position with him close). */
  boomZoomHighOnly: false,
  /** Static energy types (traits.ts ENERGY) fly boom-and-zoom against any fighter. */
  boomZoomEnergy: false,
  /** Veterans/aces who are unseen set up above (and up-sun) before attacking. */
  stalk: true,
  /** Out-turned or damaged pilots dive/run for cloud or home instead of flat breaks. */
  cloudEscape: true,
  /** Veterans and aces turn up into an attacker diving on them from above (Dicta Boelcke 6). */
  meetBounce: true,
  /** Pursuers fly to where they last saw a target they can no longer see. */
  memoryPursuit: true,
};

export function applyTacticsFlagsFromEnv(env: Record<string, string | undefined>): void {
  const raw = env.AI_TACTICS;
  if (!raw) return;
  for (const kv of raw.split(',')) {
    const [k, v] = kv.split('=');
    if (k in TACTICS_FLAGS) (TACTICS_FLAGS as Record<string, boolean>)[k] = v !== '0' && v !== 'false';
  }
}

export interface TacticsProfile {
  /** Seconds a pilot will spend setting up an attack before he goes in anyway. */
  patience: number;
  /** Preferred height advantage for a diving attack, m. */
  heightAdv: number;
  /** 0..1: how much he works round to attack out of the sun. */
  sunUse: number;
  /** Target-score bonus for an enemy alone, far from its friends. */
  stragglerBias: number;
  /** Target-score bonus for two-seaters. */
  twoSeaterBias: number;
  /** Multiplier on the skill's burst length (short, disciplined bursts < 1). */
  burstScale: number;
  /** Multiplier on the skill's opening-fire range. */
  fireRangeScale: number;
  /** 0..1: willingness to stay in a turning fight he isn't winning (brawlers ~1). */
  commitment: number;
  /** Airframe damage (0..1 summed zones) at which he breaks off and goes home. */
  disengageDamage: number;
}

/** Generic pilots: novices charge straight in, aces take their time. */
export function tacticsProfile(skillT: number, tactics?: AceTactics): TacticsProfile {
  const t = clamp(skillT, 0, 1);
  const base: TacticsProfile = {
    patience: t < 0.3 ? 0 : lerp(0, 60, (t - 0.3) / 0.7),
    heightAdv: lerp(150, 350, t),
    sunUse: t < 0.5 ? 0 : lerp(0, 0.8, (t - 0.5) / 0.5),
    stragglerBias: 0,
    twoSeaterBias: 0,
    burstScale: 1,
    fireRangeScale: 1,
    commitment: 0.5,
    // Generic pilots leave on the zone limits in the controller alone.
    disengageDamage: Infinity,
  };
  switch (tactics) {
    case 'stalker':
      return { ...base, patience: 120, heightAdv: 450, sunUse: 1, stragglerBias: 0.35, twoSeaterBias: 0.2, burstScale: 0.6, fireRangeScale: 0.8, commitment: 0.2, disengageDamage: 0.45 };
    case 'lone-hunter':
      return { ...base, patience: 25, heightAdv: 250, sunUse: 0.7, stragglerBias: 0.3, burstScale: 1.3, commitment: 0.7, disengageDamage: 0.8 };
    case 'leader':
      return { ...base, patience: 75, heightAdv: 400, sunUse: 1, stragglerBias: 0.45, twoSeaterBias: 0.25, burstScale: 0.8, commitment: 0.35, disengageDamage: 0.6 };
    case 'brawler':
      return { ...base, patience: 10, heightAdv: 200, sunUse: 0.3, burstScale: 1.2, fireRangeScale: 0.9, commitment: 1 };
    case 'two-seater-hunter':
      return { ...base, patience: 90, heightAdv: 300, sunUse: 0.6, stragglerBias: 0.3, twoSeaterBias: 0.7, burstScale: 0.8, fireRangeScale: 0.85, commitment: 0.4, disengageDamage: 0.6 };
    case 'calculated':
      return { ...base, patience: 90, heightAdv: 400, sunUse: 0.9, stragglerBias: 0.3, burstScale: 0.8, commitment: 0.2, disengageDamage: 0.45 };
    default:
      return base;
  }
}

export function aceTactics(aceId: string | undefined): AceTactics | undefined {
  return aceId ? getAce(aceId)?.tactics : undefined;
}

export function wingLoading(ac: AircraftEntity): number {
  const p = ac.spec.performance;
  return p.massLoaded / p.wingArea;
}

/** Wing loading this far above the target's: don't turn with him. */
export const OUT_TURNED_RATIO = 1.2;

/** True when `self` can't expect to win a sustained turning fight against `target`. */
export function outTurnedBy(self: AircraftEntity, target: AircraftEntity): boolean {
  if (target.spec.role !== 'fighter') return false;
  return wingLoading(self) >= OUT_TURNED_RATIO * wingLoading(target);
}

/** Angle (rad) between the line from `from` to `to` and the sun; Infinity with no sun above the horizon. */
export function sunLineAngle(from: Vector3, to: Vector3, world: WorldQuery): number {
  const sun = world.sunDirection;
  if (!sun || sun.y < 0.05) return Infinity;
  _d.copy(to).sub(from);
  const len = _d.length();
  if (len < 1) return Infinity;
  return Math.acos(clamp(_d.dot(sun) / len, -1, 1));
}
const _d = new Vector3();

/**
 * Where to set up a diving attack on `target`: `heightAdv` above it and, weighted by
 * `sunUse`, along the line from the target toward the sun (so the target must look into
 * the sun to see the attack coming). Writes into `out`.
 */
export function attackSetupPoint(target: AircraftEntity, world: WorldQuery, heightAdv: number, sunUse: number, out: Vector3): Vector3 {
  const tp = target.state.position;
  const tv = target.state.velocity;
  const sun = world.sunDirection;
  // Default: above and a little behind.
  out.set(tv.x, 0, tv.z);
  if (out.lengthSq() > 1) out.normalize().multiplyScalar(-400);
  else out.set(0, 0, 0);
  out.y = heightAdv;
  if (sun && sun.y > 0.05 && sunUse > 0) {
    // Along the sun line from the target, far enough out to have the height.
    const d = clamp(heightAdv / sun.y, 600, 1600);
    _s.copy(sun).multiplyScalar(d);
    _s.y = Math.max(_s.y, heightAdv);
    out.lerp(_s, clamp(sunUse, 0, 1));
  }
  return out.add(tp);
}
const _s = new Vector3();

/**
 * Stand-in until perception's `likelySpottedBy` lands: could `watcher` plausibly have seen
 * `self`? Inside ~3.5 km, not hidden in his rear blind cone, and not within 12° of the sun
 * as he sees it.
 */
export function spottedByEstimate(self: AircraftEntity, watcher: AircraftEntity, world: WorldQuery): boolean {
  _d.copy(self.state.position).sub(watcher.state.position);
  const r = _d.length();
  if (r > 3500) return false;
  if (r < 400) return true;
  _f.set(0, 0, -1).applyQuaternion(watcher.state.orientation);
  const off = Math.acos(clamp(_d.dot(_f) / r, -1, 1));
  if (off > (150 * Math.PI) / 180) return false;
  if (sunLineAngle(watcher.state.position, self.state.position, world) < (12 * Math.PI) / 180) return false;
  return true;
}
const _f = new Vector3();
