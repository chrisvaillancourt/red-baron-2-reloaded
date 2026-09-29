/**
 * Tail-hold diagnostic: how long an attacker sits on a defender's tail, and what the
 * defender does about it. "On the tail" means an enemy fighter with forward guns inside
 * 400 m and within 60 degrees of dead astern. While that lasts, the tracker adds up the
 * defender's AI state (phase and manoeuvre kind), mean bank, height change, and the time
 * spent circling: turning at more than 6 deg/s the same way as 3 s earlier ("circle"),
 * and the part of that with less than 6 m/s of climb or sink ("flat"). Used by the real-sim defence test and the
 * tail-hold soak.
 *
 * Visible variety: the share of held time *not* in a constant-direction turn (1 - circle),
 * and, per tail-hold episode of 3 s or more, the number of distinct AI states flown (phase
 * and manoeuvre kind: "defend break", "defend scissors", "engage", ...).
 */
import { Vector3 } from 'three';
import type { AircraftEntity } from '../../core/types';
import { angleBetween, forwardOf, headingOf, rightOf, upOf, wrapPi } from '../math';

export const TAIL_RANGE_M = 400;
export const TAIL_CONE_RAD = (60 * Math.PI) / 180;
const FLAT_TURN_RATE = (6 * Math.PI) / 180;
const FLAT_VS = 6;
const HISTORY_S = 3;

export interface TailHoldAcc {
  /** Seconds with an enemy on the tail. */
  held: number;
  /** Of those, seconds in a sustained turn: the same way as 3 s earlier, at any climb or sink. */
  circle: number;
  /** Of those, seconds in a sustained flat circle (under 6 m/s of climb or sink). */
  flat: number;
  /** Sum of |bank| (rad) x dt while held, for the mean. */
  bankSum: number;
  /** Net height change while held, m (negative = lost height). */
  dh: number;
  /** Longest single stretch with the same enemy on the tail, s. */
  longest: number;
  /** Seconds per AI state ("defend break", "engage", ...). */
  states: Map<string, number>;
  /** Stretches (separate tail-holds) seen. */
  stretches: number;
  /** Hits taken while held, per AI state at the time of the hit. */
  hitsByState: Map<string, number>;
  /** Tail-hold episodes of EPISODE_MIN_S or more, and the distinct AI states flown in them, summed. */
  episodes: number;
  kindsSum: number;
}

export const zeroTailHold = (): TailHoldAcc => ({ held: 0, circle: 0, flat: 0, bankSum: 0, dh: 0, longest: 0, states: new Map(), stretches: 0, hitsByState: new Map(), episodes: 0, kindsSum: 0 });

/** Shortest tail-hold counted as an episode for the variety count, s. */
const EPISODE_MIN_S = 3;

interface Track {
  /** Heading-rate samples over the last HISTORY_S seconds: [time, rate]. */
  rates: [number, number][];
  lastHeading: number | null;
  lastY: number;
  holder: number | null;
  since: number;
  /** Bucket key and AI state at the last sample, while held. */
  heldKey: string | null;
  heldState: string;
  /** Distinct AI states flown in the current episode. */
  kinds: Set<string>;
}

const _rel = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();

/** The enemy on `self`'s tail (nearest inside the cone and range), if any. */
export function tailHolder(self: AircraftEntity, all: readonly AircraftEntity[]): AircraftEntity | null {
  if (self.outcome || !self.state) return null;
  const back = forwardOf(self.state.orientation, _f).negate();
  let best: AircraftEntity | null = null;
  let bestR = TAIL_RANGE_M;
  for (const e of all) {
    if (e.side === self.side || e.outcome || !e.spec.guns.some((g) => g.mount !== 'flexible')) continue;
    _rel.copy(e.state.position).sub(self.state.position);
    const r = _rel.length();
    if (r > bestR || angleBetween(back, _rel) > TAIL_CONE_RAD) continue;
    best = e;
    bestR = r;
  }
  return best;
}

/** Bank angle (rad, signed, right wing down positive) from the body axes. */
export function bankOf(ac: AircraftEntity): number {
  const right = rightOf(ac.state.orientation, _r);
  const up = upOf(ac.state.orientation, _u);
  return Math.atan2(-right.y, up.y);
}

export class TailHoldTracker {
  private readonly tracks = new Map<number, Track>();
  private time = 0;

  constructor(
    private readonly aircraft: () => readonly AircraftEntity[],
    /** AI state label for an aircraft (e.g. its controller's debugState), or '' for none. */
    private readonly stateOf: (a: AircraftEntity) => string,
    /** Bucket key for a defender, or null to skip it. */
    private readonly keyOf: (a: AircraftEntity) => string | null,
    readonly acc: Map<string, TailHoldAcc> = new Map(),
    /** Count only tail-holds by these attackers (default: any enemy). */
    private readonly holderOk: (holder: AircraftEntity) => boolean = () => true,
  ) {}

  /** Call at a steady rate (dt seconds apart). */
  sample(dt: number): void {
    this.time += dt;
    const all = this.aircraft();
    for (const a of all) {
      if (a.outcome || !a.state) continue;
      const key = this.keyOf(a);
      if (key == null) continue;
      let tr = this.tracks.get(a.id);
      if (!tr) this.tracks.set(a.id, (tr = { rates: [], lastHeading: null, lastY: a.state.position.y, holder: null, since: 0, heldKey: null, heldState: '-', kinds: new Set() }));
      const v = a.state.velocity;
      const h = headingOf(v);
      const rate = tr.lastHeading == null ? 0 : wrapPi(h - tr.lastHeading) / dt;
      tr.lastHeading = h;
      tr.rates.push([this.time, rate]);
      while (tr.rates.length && tr.rates[0][0] < this.time - HISTORY_S) tr.rates.shift();
      const dy = a.state.position.y - tr.lastY;
      tr.lastY = a.state.position.y;
      const found = tailHolder(a, all);
      const holder = found && this.holderOk(found) ? found : null;
      if (!holder) {
        this.endEpisode(tr);
        tr.holder = null;
        tr.heldKey = null;
        continue;
      }
      let g = this.acc.get(key);
      if (!g) this.acc.set(key, (g = zeroTailHold()));
      if (tr.holder !== holder.id) {
        this.endEpisode(tr);
        tr.holder = holder.id;
        tr.since = this.time;
        g.stretches++;
      }
      g.held += dt;
      g.longest = Math.max(g.longest, this.time - tr.since);
      g.bankSum += Math.abs(bankOf(a)) * dt;
      g.dh += dy;
      const old = tr.rates[0][1];
      const circling = Math.abs(rate) > FLAT_TURN_RATE && Math.sign(rate) === Math.sign(old) && Math.abs(old) > FLAT_TURN_RATE;
      if (circling) g.circle += dt;
      if (circling && Math.abs(v.y) < FLAT_VS) g.flat += dt;
      const s = this.stateOf(a).replace(/ #\d+/, '').trim() || '-';
      g.states.set(s, (g.states.get(s) ?? 0) + dt);
      tr.kinds.add(s.replace(/ (recover|pull-up)/g, ''));
      tr.heldKey = key;
      tr.heldState = s;
    }
    // Aircraft that went down end their episode too.
    for (const [id, tr] of this.tracks) if (tr.holder != null && !all.some((a) => a.id === id && !a.outcome)) this.endEpisode(tr);
  }

  /** Close any open episodes (call once at the end of a run). */
  finish(): void {
    for (const tr of this.tracks.values()) this.endEpisode(tr);
  }

  private endEpisode(tr: Track): void {
    const g = tr.heldKey != null ? this.acc.get(tr.heldKey) : undefined;
    if (g && tr.holder != null && this.time - tr.since >= EPISODE_MIN_S) {
      g.episodes++;
      g.kindsSum += tr.kinds.size;
    }
    tr.kinds.clear();
    tr.holder = null;
  }

  /** A bullet hit `targetId`: counted against its state if an enemy was on its tail. */
  onHit(targetId: number): void {
    const tr = this.tracks.get(targetId);
    if (!tr || tr.heldKey == null) return;
    const g = this.acc.get(tr.heldKey);
    if (g) g.hitsByState.set(tr.heldState, (g.hitsByState.get(tr.heldState) ?? 0) + 1);
  }
}

/** One summary line per bucket. */
export function tailHoldLine(key: string, g: TailHoldAcc, runs: number): string {
  const top = [...g.states]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, s]) => `${k} ${Math.round((100 * s) / Math.max(g.held, 1e-9))}% (${((g.hitsByState.get(k) ?? 0) / Math.max(s, 1e-9)).toFixed(2)} hits/s)`)
    .join(', ');
  const hits = [...g.hitsByState.values()].reduce((a, b) => a + b, 0);
  return [
    key.padEnd(24),
    `held ${(g.held / runs).toFixed(0)} s/run`,
    `circle ${Math.round((100 * g.circle) / Math.max(g.held, 1e-9))}%`,
    `varied ${Math.round(100 - (100 * g.circle) / Math.max(g.held, 1e-9))}%`,
    `kinds/episode ${(g.kindsSum / Math.max(g.episodes, 1)).toFixed(2)} (${g.episodes})`,
    `flat ${Math.round((100 * g.flat) / Math.max(g.held, 1e-9))}%`,
    `bank ${((g.bankSum / Math.max(g.held, 1e-9)) * 57.3).toFixed(0)} deg`,
    `dh ${(g.dh / runs).toFixed(0)} m/run`,
    `longest ${g.longest.toFixed(0)} s`,
    `stretches ${g.stretches}`,
    `hits taken ${(hits / runs).toFixed(1)}/run (${(hits / Math.max(g.held, 1e-9)).toFixed(2)}/s)`,
    `states: ${top}`,
  ].join(' | ');
}
