/**
 * What an AI pilot knows: spotted enemies (with skill-limited range, a blind
 * cone behind/below, memory) and how threatening each one is.
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity } from '../core/types';
import { angleBetween, clamp, DEG, forwardOf } from './math';
import type { SkillProfile } from './skill';

export function isAlive(ac: AircraftEntity): boolean {
  return !ac.outcome && !ac.damage.destroyed && !ac.damage.pilotKilled;
}

const _rel = new Vector3();
const _f = new Vector3();

export class Perception {
  /** Enemy id -> last time seen. */
  readonly contacts = new Map<number, number>();
  private nextSweep = 0;

  constructor(private readonly profile: SkillProfile) {}

  /** Periodic visual sweep. Returns true when a sweep ran this call. */
  sweep(self: AircraftEntity, world: WorldQuery, rng: () => number): boolean {
    if (world.time < this.nextSweep) return false;
    const p = this.profile;
    this.nextSweep = world.time + p.perceptionInterval * (0.75 + 0.5 * rng());
    const fwd = forwardOf(self.state.orientation, _f);
    for (const e of world.aircraft) {
      if (e.side === self.side || !isAlive(e)) continue;
      _rel.copy(e.state.position).sub(self.state.position);
      const r = _rel.length();
      if (r > p.spotRange) continue;
      // Blind cone behind the tail (and a bit below).
      const behind = angleBetween(_rel, fwd.clone().negate().add(new Vector3(0, -0.3, 0)));
      if (behind < p.rearBlindCone && r > p.blindSpotRange) continue;
      this.contacts.set(e.id, world.time);
    }
    for (const [id, t] of this.contacts) {
      const e = world.getEntity(id);
      if (!e || e.kind !== 'aircraft' || !isAlive(e) || world.time - t > p.memory) this.contacts.delete(id);
    }
    return true;
  }

  /** Force-notice an aircraft (e.g. it just hit us). */
  notice(id: number, time: number): void {
    this.contacts.set(id, time);
  }

  knownEnemies(world: WorldQuery): AircraftEntity[] {
    const out: AircraftEntity[] = [];
    for (const id of this.contacts.keys()) {
      const e = world.getEntity(id);
      if (e && e.kind === 'aircraft' && isAlive(e)) out.push(e);
    }
    return out;
  }
}

/** 0..1: how dangerous `e` is to `self` right now (nose-on and close = high). */
export function threatLevel(self: AircraftEntity, e: AircraftEntity): number {
  _rel.copy(self.state.position).sub(e.state.position);
  const r = _rel.length();
  if (r > 1500) return 0;
  const ef = forwardOf(e.state.orientation, _f);
  const nose = angleBetween(ef, _rel);
  const hasForwardGuns = e.spec.guns.some((g) => g.mount !== 'flexible');
  if (!hasForwardGuns) return 0;
  let t = clamp(1 - r / 1200, 0, 1) * clamp(1 - nose / (35 * DEG), 0, 1);
  if (r < 300 && nose < 60 * DEG) t = Math.max(t, 0.7);
  // Enemy two-seaters' rear gunners threaten us when we sit behind them (handled by caution in attack code).
  return t;
}

/** Is `e` currently attacking `friend` (nose-on, in gun range)? */
export function isAttacking(e: AircraftEntity, friend: AircraftEntity, range = 700): boolean {
  _rel.copy(friend.state.position).sub(e.state.position);
  const r = _rel.length();
  if (r > range) return false;
  return angleBetween(forwardOf(e.state.orientation, _f), _rel) < 30 * DEG;
}
