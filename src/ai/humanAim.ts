/**
 * Human-like aim for an AI-flown pursuer: a stand-in for a mouse-aim player, so that tactics
 * aimed at players can be measured against something closer to one than the veteran
 * autoplayer (FRICTION F-23: the autoplayer aims with a computed lead and near-instant
 * reactions, so every change of direction is punished at once).
 *
 * The model, per tick, while tracking one target:
 *   1. **Reaction delay.** The target's motion is read as it was `reactionS` ago and
 *      extrapolated to now. A steady turn is read correctly; a reversal is not noticed until
 *      `reactionS` later.
 *   2. **Lead.** A lead solution on that reading, at `leadFraction` of the full lead (there is
 *      no lead marker on the standard flight model, so players under-lead).
 *   3. **Bias.** A slowly drifting misjudgement of where the lead is (Ornstein-Uhlenbeck,
 *      `biasRad` 1-sigma, `biasTauS`). The pilot believes this biased point is the lead.
 *   4. **Aim lag.** The aim point follows that belief through a first-order lag (`aimLagS`),
 *      starting from wherever the nose pointed when he took up the target.
 *   5. **Jitter.** Fast hand noise on top (`noiseRad`, `noiseTauS`). The nose is flown at the
 *      result by the ordinary autopilot, as the mouse-aim instructor flies a player's cursor.
 *   6. **Fire discipline.** He fires when the nose is on his believed lead (not the true one)
 *      inside `fireRangeM`, in long bursts, and keeps the trigger down through small misses.
 *
 * Used by the controller when `AIControllerOptions.human` is set; the autoplayer sets it for
 * the player's aircraft with `AUTOPLAY_PILOT=human` (src/game/autoplay.ts). Calibration: fitted
 * to the user's recorded mouse-aim flights (docs/ai.md "Human-like pursuer").
 */
import { Vector3 } from 'three';
import { leadSolution, type LeadSolution } from './gunnery';
import { angleBetween, DEG, rightOf, upOf } from './math';
import type { AircraftEntity } from '../core/types';

export interface HumanPilotParams {
  /** First-order lag of the aim point behind the believed lead, s (mouse-aim: 0.2-0.4). */
  aimLagS: number;
  /** The target's motion is read this long ago, s: a change of direction goes unnoticed this long. */
  reactionS: number;
  /** Fraction of the true lead held (no lead marker on the standard flight model). */
  leadFraction: number;
  /** Slow misjudgement of the lead point: 1-sigma, rad, and correlation time, s. */
  biasRad: number;
  biasTauS: number;
  /** Fast hand jitter: 1-sigma, rad, and correlation time, s. */
  noiseRad: number;
  noiseTauS: number;
  /** Opens fire inside this range, m. */
  fireRangeM: number;
  /** Fires when the nose is within the target's angular radius plus this of his believed lead, rad. */
  fireConeRad: number;
  /** Keeps a burst going while within this (plus the target's size), rad. */
  holdConeRad: number;
  /** Mean burst length and pause between bursts, s. */
  burstS: number;
  burstPauseS: number;
}

/**
 * Fitted to the user's mouse-aim flights (docs/ai.md "Human-like pursuer"). The lag, reaction
 * and fire-discipline figures are set from typical mouse-aim play; the bias and jitter
 * amplitudes carry the fit: the report's Bristol against ace D.VIIs at 300 m hit with about
 * 12% of its fixed-gun rounds (10-14% once the observer's rear gun is taken out), which this
 * pilot matches in that scene (defence.realsim.test.ts). Loosely constrained: two usable
 * flights, and bias and jitter three times larger only take it to 6%.
 */
export const HUMAN_PILOT: HumanPilotParams = {
  aimLagS: 0.3,
  reactionS: 0.35,
  leadFraction: 0.85,
  biasRad: 0.42 * DEG,
  biasTauS: 3,
  noiseRad: 0.21 * DEG,
  noiseTauS: 0.25,
  fireRangeM: 380,
  fireConeRad: 3 * DEG,
  holdConeRad: 6 * DEG,
  burstS: 1.5,
  burstPauseS: 0.5,
};

/**
 * `AUTOPLAY_PILOT=human` gives HUMAN_PILOT, with any field overridden by `AUTOPLAY_HUMAN`
 * (`aimLagS=0.4,biasDeg=2,...`; fields ending in Rad may be given in degrees as `...Deg`),
 * for calibration sweeps. Anything else: undefined (the ordinary AI pilot).
 */
export function humanPilotFromEnv(env: Record<string, string | undefined>): HumanPilotParams | undefined {
  if ((env.AUTOPLAY_PILOT ?? '').trim() !== 'human') return undefined;
  const p: HumanPilotParams = { ...HUMAN_PILOT };
  for (const kv of (env.AUTOPLAY_HUMAN ?? '').split(',')) {
    if (!kv.trim()) continue;
    const [k0, v] = kv.split('=');
    const k = k0.trim();
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`AUTOPLAY_HUMAN: ${JSON.stringify(kv)} is not key=number`);
    const key = (k.endsWith('Deg') ? k.slice(0, -3) + 'Rad' : k) as keyof HumanPilotParams;
    if (!(key in p)) throw new Error(`AUTOPLAY_HUMAN: unknown field ${JSON.stringify(k)} (fields: ${Object.keys(p).join(', ')})`);
    p[key] = k.endsWith('Deg') ? n * DEG : n;
  }
  return p;
}

/** How much target history is kept, s (enough for the reaction delay plus the turn reading). */
const HISTORY_S = 1.5;
/** A gap this long in tracking (s) starts afresh: he has taken up a new target. */
const RESET_GAP_S = 0.5;
/** The target's turn is read over this interval, s. */
const ACC_WINDOW_S = 0.25;

interface Sample {
  t: number;
  vel: Vector3;
}

const _r = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _a = new Vector3();

export class HumanAim {
  private readonly hist: Sample[] = [];
  private targetId: number | null = null;
  private lastT = -100;
  /** World direction of the aim point (unit). */
  private readonly aim = new Vector3();
  /** The lead as he believes it (unit, world), last tick. */
  readonly believed = new Vector3();
  private readonly lead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };
  private bx = 0;
  private by = 0;
  private nx = 0;
  private ny = 0;
  burstUntil = 0;
  burstNext = 0;

  constructor(
    readonly p: HumanPilotParams,
    private readonly rng: () => number,
  ) {
    // Start with a bias already drawn, so the first engagement is not error-free.
    this.bx = gauss(rng) * p.biasRad;
    this.by = gauss(rng) * p.biasRad;
  }

  /** Is he tracking `targetId` right now (tracked within the reset gap)? */
  tracking(targetId: number, now: number): boolean {
    return this.targetId === targetId && now - this.lastT < RESET_GAP_S;
  }

  /**
   * One tick of tracking `target` (an aircraft, or a fixed point with `vel` zero). Writes the
   * direction to fly the nose along into `out` (unit).
   */
  track(self: AircraftEntity, targetId: number, targetPos: Vector3, targetVel: Vector3, muzzleVelocity: number, now: number, dt: number, out: Vector3): Vector3 {
    const s = self.state;
    const p = this.p;
    if (this.targetId !== targetId || now - this.lastT > RESET_GAP_S) {
      this.targetId = targetId;
      this.hist.length = 0;
      // He takes up the target from wherever the nose points now.
      this.aim.copy(s.velocity.lengthSq() > 1 ? s.velocity : _v.set(0, 0, -1).applyQuaternion(s.orientation)).normalize();
    }
    this.lastT = now;
    this.hist.push({ t: now, vel: targetVel.clone() });
    while (this.hist.length > 2 && this.hist[0].t < now - HISTORY_S) this.hist.shift();

    // 1. Reaction delay: the target's velocity and turn as seen reactionS ago, extrapolated.
    const seen = this.at(now - p.reactionS);
    const before = this.at(now - p.reactionS - ACC_WINDOW_S);
    const span = seen.t - before.t;
    _a.set(0, 0, 0);
    if (span > 0.05) _a.copy(seen.vel).sub(before.vel).divideScalar(span);
    const age = now - seen.t;
    _v.copy(seen.vel).addScaledVector(_a, age);
    // 2. Lead on that reading, under-led.
    leadSolution(s.position, s.velocity, targetPos, _v, _a, muzzleVelocity, p.leadFraction, this.lead);
    // 3. Bias: the slow misjudgement, in the pilot's own right/up axes.
    const kb = Math.sqrt((2 * dt) / p.biasTauS) * p.biasRad;
    this.bx += (-this.bx * dt) / p.biasTauS + kb * gauss(this.rng);
    this.by += (-this.by * dt) / p.biasTauS + kb * gauss(this.rng);
    const r = rightOf(s.orientation, _r);
    const u = upOf(s.orientation, _u);
    this.believed.copy(this.lead.dir).addScaledVector(r, this.bx).addScaledVector(u, this.by).normalize();
    // 4. Aim lag.
    const k = 1 - Math.exp(-dt / Math.max(p.aimLagS, 1e-3));
    this.aim.lerp(this.believed, k).normalize();
    // 5. Jitter.
    const kn = Math.sqrt((2 * dt) / p.noiseTauS) * p.noiseRad;
    this.nx += (-this.nx * dt) / p.noiseTauS + kn * gauss(this.rng);
    this.ny += (-this.ny * dt) / p.noiseTauS + kn * gauss(this.rng);
    return out.copy(this.aim).addScaledVector(r, this.nx).addScaledVector(u, this.ny).normalize();
  }

  /** Angle from the gun line `f` to where he believes the lead is, rad (Infinity when not tracking `targetId`). */
  believedError(f: Vector3, targetId: number, now: number): number {
    return this.tracking(targetId, now) ? angleBetween(f, this.believed) : Infinity;
  }

  /** Should the trigger be down? `size`: the target's angular radius, rad; `r`: range, m. */
  wantsFire(err: number, size: number, r: number, now: number, fireRange = this.p.fireRangeM): boolean {
    const p = this.p;
    const firing = now < this.burstUntil;
    if (firing) return r < fireRange * 1.2 && err < size + p.holdConeRad;
    if (now < this.burstNext || r >= fireRange || err >= size + p.fireConeRad) return false;
    this.burstUntil = now + p.burstS * (0.6 + 0.8 * this.rng());
    this.burstNext = this.burstUntil + p.burstPauseS * (0.5 + this.rng());
    return true;
  }

  /** The newest sample at or before `t` (the oldest kept when none is that old). */
  private at(t: number): Sample {
    let best = this.hist[0];
    for (const h of this.hist) {
      if (h.t > t) break;
      best = h;
    }
    return best;
  }
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
