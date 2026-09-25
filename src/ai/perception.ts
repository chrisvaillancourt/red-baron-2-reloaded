/**
 * What an AI pilot knows: spotted enemies (with skill-limited range, a blind
 * cone behind/below, memory of where each was last seen) and how threatening
 * each one is.
 *
 * Sight is impaired by the sun and by cloud (DECISIONS "Perception: sun glare,
 * cloud and memory"): an enemy close to the line of the sun is spotted at a
 * fraction of the normal range, and cloud on the line of sight (the same clouds
 * the renderer draws, `WorldQuery.cloudTransmittance`) scales the range by the
 * light that gets through, so a pilot inside a cloud drops out of sight and out of
 * memory after `SkillProfile.memory` seconds.
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity } from '../core/types';
import { angleBetween, clamp, DEG, forwardOf, lerp } from './math';
import type { SkillProfile } from './skill';

export function isAlive(ac: AircraftEntity): boolean {
  return !ac.outcome && !ac.damage.destroyed && !ac.damage.pilotKilled;
}

export interface Contact {
  /** Mission time last seen. */
  lastSeen: number;
  /** World position when last seen (owned copy). */
  position: Vector3;
  /** Velocity when last seen (owned copy). */
  velocity: Vector3;
  /** Seen on the latest sweep (or just now forced by `notice`). */
  visible: boolean;
}

// ---- sun glare ---------------------------------------------------------------

/** Glare is full inside this angle from the sun and gone beyond GLARE_EDGE. */
const GLARE_CORE = 5 * DEG;
const GLARE_EDGE = 15 * DEG;
/** Sun elevation (sin) over which glare ramps in: haze near the horizon dims it. */
const GLARE_EL_LO = Math.sin(2 * DEG);
const GLARE_EL_HI = Math.sin(6 * DEG);
/** How far toward the sun the observer's own view of it is checked for cloud, m. */
const SUN_RAY_M = 3000;

/** Angle (rad) between the line of sight from `from` to `to` and the sun; Infinity with no sun or the sun below the horizon. */
export function sunAngle(from: Vector3, to: Vector3, world: WorldQuery): number {
  const sun = world.sunDirection;
  if (!sun || sun.y <= 0) return Infinity;
  _los.copy(to).sub(from);
  if (_los.lengthSq() < 1e-6) return Infinity;
  return _los.angleTo(sun);
}

/** 0..1 strength of the sun's glare from its elevation (0 below ~2°, full above ~6°). */
function sunStrength(world: WorldQuery): number {
  const sun = world.sunDirection;
  if (!sun) return 0;
  return clamp((sun.y - GLARE_EL_LO) / (GLARE_EL_HI - GLARE_EL_LO), 0, 1);
}

/**
 * 0..1 range multiplier for a target `angle` rad from the sun. At the core a novice
 * sees 12% as far and an ace 30% (a thumb over the sun, squinting past it).
 */
export function glareFactor(angle: number, strength: number, skillT: number): number {
  if (strength <= 0 || angle >= GLARE_EDGE) return 1;
  const w = angle <= GLARE_CORE ? 1 : 1 - smooth((angle - GLARE_CORE) / (GLARE_EDGE - GLARE_CORE));
  const floor = lerp(0.12, 0.3, skillT);
  return 1 - strength * w * (1 - floor);
}

/** Is the sun itself visible from `p` (not behind cloud)? 0..1. */
function sunVisibleFrom(p: Vector3, world: WorldQuery): number {
  const sun = world.sunDirection;
  if (!sun || !world.cloudTransmittance) return 1;
  _sunEnd.copy(p).addScaledVector(sun, SUN_RAY_M);
  return world.cloudTransmittance(p, _sunEnd);
}

/** 0..1 multiplier on the observer's spotting range for this target: sun glare × cloud transmittance (1 = unimpaired). */
export function sightFactor(observer: AircraftEntity, target: AircraftEntity, world: WorldQuery, skillT: number): number {
  const from = observer.state.position;
  const to = target.state.position;
  let f = 1;
  const a = sunAngle(from, to, world);
  if (a < GLARE_EDGE) f = glareFactor(a, sunStrength(world) * sunVisibleFrom(from, world), skillT);
  if (world.cloudTransmittance) f *= world.cloudTransmittance(from, to);
  return f;
}

// ---- perception --------------------------------------------------------------

const _rel = new Vector3();
const _f = new Vector3();
const _f2 = new Vector3();
const _los = new Vector3();
const _sunEnd = new Vector3();
const _rearDir = new Vector3();
const REAR_BIAS = new Vector3(0, -0.3, 0);

/** Perception by owning aircraft, so `likelySpottedBy` can read an AI watcher's real contacts. */
const REGISTRY = new WeakMap<AircraftEntity, Perception>();

/** The perception of an AI-flown aircraft (tests, diagnostics), if it has one. */
export function perceptionOf(ac: AircraftEntity): Perception | undefined {
  return REGISTRY.get(ac);
}

export class Perception {
  /** Enemy id -> what we know of it. */
  readonly contacts = new Map<number, Contact>();
  private nextSweep = 0;
  /** Noticed without an entity (e.g. the id of whoever just hit us): position filled in from the world. */
  private readonly pending = new Set<number>();

  constructor(
    readonly profile: SkillProfile,
    owner?: AircraftEntity,
  ) {
    if (owner) REGISTRY.set(owner, this);
  }

  /** Periodic visual sweep. Returns true when a sweep ran this call. */
  sweep(self: AircraftEntity, world: WorldQuery, rng: () => number): boolean {
    if (world.time < this.nextSweep) return false;
    const p = this.profile;
    this.nextSweep = world.time + p.perceptionInterval * (0.75 + 0.5 * rng());
    this.resolvePending(world);
    const pos = self.state.position;
    const fwd = forwardOf(self.state.orientation, _f);
    const rear = _rearDir.copy(fwd).negate().add(REAR_BIAS);
    // Good pilots periodically twist round to check their tail.
    const checkSix = rng() < p.t * 0.35;
    const strength = sunStrength(world);
    let sunVis = -1; // lazily: is the sun behind cloud from here?
    for (const c of this.contacts.values()) c.visible = false;
    for (const e of world.aircraft) {
      if (e.side === self.side || !isAlive(e)) continue;
      _rel.copy(e.state.position).sub(pos);
      const r = _rel.length();
      if (r > p.spotRange) continue;
      // Blind cone behind the tail (and a bit below): only close enemies are noticed there.
      const blind = !checkSix && angleBetween(_rel, rear) < p.rearBlindCone;
      let range = blind ? p.blindSpotRange : p.spotRange;
      if (r > range) continue;
      // Sun glare: the enemy is close to the line of the sun.
      if (strength > 0) {
        const a = sunAngle(pos, e.state.position, world);
        if (a < GLARE_EDGE) {
          if (sunVis < 0) sunVis = sunVisibleFrom(pos, world);
          range *= glareFactor(a, strength * sunVis, p.t);
          if (r > range) continue;
        }
      }
      // Cloud on the line of sight (only rays that cross the cloud band cost anything).
      if (world.cloudTransmittance && r > range * world.cloudTransmittance(pos, e.state.position)) continue;
      this.see(e, world.time);
    }
    for (const [id, c] of this.contacts) {
      const e = world.getEntity(id);
      if (!e || e.kind !== 'aircraft' || !isAlive(e) || world.time - c.lastSeen > p.memory) this.contacts.delete(id);
    }
    return true;
  }

  /** What we know of an enemy, or undefined if it isn't (or is no longer) remembered. */
  contact(id: number): Contact | undefined {
    return this.contacts.get(id);
  }

  /** Force-notice an aircraft (e.g. it just hit us). Without `e`, its position is read from the world at the next sweep or query. */
  notice(id: number, time: number, e?: AircraftEntity): void {
    if (e) {
      this.see(e, time);
      this.pending.delete(id);
      return;
    }
    const c = this.contacts.get(id);
    if (c) {
      c.lastSeen = time;
      c.visible = true;
    } else {
      this.contacts.set(id, { lastSeen: time, position: new Vector3(), velocity: new Vector3(), visible: true });
    }
    this.pending.add(id);
  }

  /** Remembered enemies that are still alive (visible or not). */
  knownEnemies(world: WorldQuery): AircraftEntity[] {
    this.resolvePending(world);
    const out: AircraftEntity[] = [];
    for (const id of this.contacts.keys()) {
      const e = world.getEntity(id);
      if (e && e.kind === 'aircraft' && isAlive(e)) out.push(e);
    }
    return out;
  }

  private see(e: AircraftEntity, time: number): void {
    const c = this.contacts.get(e.id);
    if (c) {
      c.lastSeen = time;
      c.position.copy(e.state.position);
      c.velocity.copy(e.state.velocity);
      c.visible = true;
    } else {
      this.contacts.set(e.id, { lastSeen: time, position: e.state.position.clone(), velocity: e.state.velocity.clone(), visible: true });
    }
  }

  private resolvePending(world: WorldQuery): void {
    if (this.pending.size === 0) return;
    for (const id of this.pending) {
      const e = world.getEntity(id);
      const c = this.contacts.get(id);
      if (c && e && e.kind === 'aircraft') {
        c.position.copy(e.state.position);
        c.velocity.copy(e.state.velocity);
      }
    }
    this.pending.clear();
  }
}

/** Spotting range and blind cone used to estimate what a human (or non-AI) pilot can see. */
const HUMAN_T = 0.6;
const HUMAN_SPOT_RANGE = lerp(2600, 5000, HUMAN_T);
const HUMAN_BLIND_CONE = 35 * DEG;
const HUMAN_BLIND_RANGE = 400;
/** An AI watcher that saw us this recently still has us. */
const SEEN_RECENTLY_S = 4;

/**
 * Best estimate of whether `watcher` has (or is about to have) seen `self`, for a
 * stalker deciding whether it is still unseen. An AI watcher's real contacts count
 * (seen within the last 4 s), plus whether we are well inside what it could see on
 * its next sweep (80% of its sun- and cloud-limited range, outside its blind cone).
 * For the player a geometric estimate stands in: a veteran's range, a 35° blind
 * cone below the tail (400 m), and the same sun and cloud.
 */
export function likelySpottedBy(self: AircraftEntity, watcher: AircraftEntity, world: WorldQuery): boolean {
  if (!isAlive(watcher)) return false;
  const per = REGISTRY.get(watcher);
  let spotRange = HUMAN_SPOT_RANGE;
  let blindCone = HUMAN_BLIND_CONE;
  let blindRange = HUMAN_BLIND_RANGE;
  let t = HUMAN_T;
  let margin = 1;
  if (per) {
    const c = per.contact(self.id);
    if (c && (c.visible || world.time - c.lastSeen < SEEN_RECENTLY_S)) return true;
    const p = per.profile;
    spotRange = p.spotRange;
    blindCone = p.rearBlindCone;
    blindRange = p.blindSpotRange;
    t = p.t;
    margin = 0.8;
  }
  _rel.copy(self.state.position).sub(watcher.state.position);
  const r = _rel.length();
  const rear = forwardOf(watcher.state.orientation, _f2).negate().add(REAR_BIAS);
  const range = angleBetween(_rel, rear) < blindCone ? blindRange : spotRange;
  if (r > range * margin) return false;
  return r <= range * margin * sightFactor(watcher, self, world, t);
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
  let t = clamp(1 - (r - 150) / 850, 0, 1) * clamp(1 - nose / (35 * DEG), 0, 1);
  if (r < 300 && nose < 60 * DEG) t = Math.max(t, 0.7);
  // Aspect: an enemy on our tail is a threat; one ahead of us is a head-on pass
  // (or our own target), not a reason to break.
  const myFwd = forwardOf(self.state.orientation, _f2);
  const toEnemy = _rel.negate();
  const off = angleBetween(myFwd, toEnemy);
  t *= clamp((off - 60 * DEG) / (60 * DEG), 0.15, 1);
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

function smooth(x: number): number {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}
