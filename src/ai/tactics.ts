/**
 * Tactical character: how a pilot sets up and chooses a fight, from skill and (for named
 * aces) the historical signature in src/data/aces.ts. Pure functions and data; the
 * controller (controller.ts) flies it.
 *
 * - **Energy tactics by matchup (off: measured worse).** Boom-and-zoom for a pilot whose
 *   wing loading is well above his target's (D.V 44 against a Camel's 31 kg/m²), or for
 *   any static energy type, lost more fights than turning did in every matchup measured
 *   (DECISIONS "Boom-and-zoom measured and rejected"). The code stays behind its flags so
 *   it can be re-measured if the flight model's dive limits change.
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
  /** Out-turned pilots (wing loading >= OUT_TURNED_RATIO x target's) fly boom-and-zoom. Off: measured worse. */
  boomZoomOutTurned: false,
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
      return { ...base, patience: 180, heightAdv: 450, sunUse: 1, stragglerBias: 0.35, twoSeaterBias: 0.2, burstScale: 0.6, fireRangeScale: 0.8, commitment: 0.2, disengageDamage: 0.45 };
    case 'lone-hunter':
      return { ...base, patience: 25, heightAdv: 250, sunUse: 0.7, stragglerBias: 0.3, burstScale: 1.3, commitment: 0.7, disengageDamage: 0.8 };
    case 'leader':
      return { ...base, patience: 120, heightAdv: 400, sunUse: 1, stragglerBias: 0.45, twoSeaterBias: 0.25, burstScale: 0.8, commitment: 0.35, disengageDamage: 0.6 };
    case 'brawler':
      return { ...base, patience: 10, heightAdv: 200, sunUse: 0.3, burstScale: 1.2, fireRangeScale: 0.9, commitment: 1 };
    case 'two-seater-hunter':
      return { ...base, patience: 150, heightAdv: 300, sunUse: 0.6, stragglerBias: 0.3, twoSeaterBias: 0.7, burstScale: 0.8, fireRangeScale: 0.85, commitment: 0.4, disengageDamage: 0.6 };
    case 'calculated':
      return { ...base, patience: 150, heightAdv: 400, sunUse: 0.9, stragglerBias: 0.3, burstScale: 0.8, commitment: 0.2, disengageDamage: 0.45 };
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

/**
 * Where to set up a diving attack on `target`: `heightAdv` above it and, weighted by
 * `sunUse`, along the line from the target toward the sun (so the target must look into
 * the sun to see the attack coming). `standoff` (m along the sun line) lets a stalker work
 * round at a distance before closing down the line. Writes into `out`.
 */
export function attackSetupPoint(target: AircraftEntity, world: WorldQuery, heightAdv: number, sunUse: number, out: Vector3, standoff?: number): Vector3 {
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
    if (standoff !== undefined) {
      // Out at the sun's bearing, at the preferred height: closing from there brings us
      // down the sun line (the target sees us inside the glare once dh/r ~ tan(elevation)).
      _s.set(sun.x, 0, sun.z).normalize().multiplyScalar(standoff);
      _s.y = heightAdv;
    } else {
      _s.copy(sun).multiplyScalar(clamp(heightAdv / sun.y, 600, 1600));
      _s.y = Math.max(_s.y, heightAdv);
    }
    out.lerp(_s, clamp(sunUse, 0, 1));
  }
  return out.add(tp);
}
const _s = new Vector3();
