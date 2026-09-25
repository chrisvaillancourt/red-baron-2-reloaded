/**
 * Scripted defensive manoeuvres. Each produces a desired flight-path
 * direction relative to the current attitude, so a "break" keeps turning
 * hard for its duration rather than aiming at a fixed point.
 *
 * Below LOW_AGL there is no height to trade: breaks are flown level (the
 * autopilot's own ground layer still decides whether over-banking is safe),
 * jinks keep their vertical wander small, there is no climbing turn, and an
 * energy fighter with a lead extends along the deck toward friendly lines,
 * where archie and small arms discourage a pursuer. (Flat scissors were
 * tried and measured worse: reversing at low speed hands a better-turning
 * attacker the shot; see DECISIONS "Low-level defence".)
 */
import { Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import { dirFromHeading, forwardOf, headingOf } from './math';
import type { SkillProfile } from './skill';
import type { AircraftTraits } from './traits';
import type { SteerCommand } from './autopilot';

export type ManeuverKind = 'break' | 'climbing-turn' | 'split-s' | 'spiral' | 'jink' | 'extend';

/** Height above ground below which defensive manoeuvres stay level. */
export const LOW_AGL = 350;

export interface Maneuver {
  kind: ManeuverKind;
  /** +1 = turn right, -1 = turn left. */
  side: 1 | -1;
  start: number;
  until: number;
  /** Heading at the start (split-S / extend reference). */
  heading0: number;
  nextReverse: number;
  /** Flown near the ground: keep it level. */
  low: boolean;
  /** Horizontal direction toward friendly lines (low-level extend). */
  homeDir?: Vector3;
}

const _f = new Vector3();
const _r = new Vector3();
const _rel = new Vector3();

export function chooseDefensive(
  self: AircraftEntity,
  attacker: AircraftEntity | undefined,
  traits: AircraftTraits,
  profile: SkillProfile,
  agl: number,
  now: number,
  rng: () => number,
  homeDir?: Vector3,
): Maneuver {
  const f = forwardOf(self.state.orientation, _f);
  const r = _r.set(-f.z, 0, f.x).normalize();
  let side: 1 | -1 = rng() < 0.5 ? 1 : -1;
  let range = Infinity;
  if (attacker) {
    _rel.copy(attacker.state.position).sub(self.state.position);
    range = _rel.length();
    // Turn toward the attacker's side to maximise angle-off and force an overshoot.
    side = _rel.dot(r) >= 0 ? 1 : -1;
  }
  // Camel/Dr.I-style torque: rotary types break right more readily.
  if (self.spec.performance.engineType === 'rotary' && rng() < 0.3) side = 1;
  const t = profile.t;
  const roll = rng();
  const low = agl < LOW_AGL;
  let kind: ManeuverKind;
  if (low) {
    // Extending only works with a lead: a pursuer inside ~450 m just follows and shoots.
    const faster = !attacker || self.state.airspeed >= attacker.state.airspeed - 2;
    const canExtend = homeDir !== undefined && faster && range > 450;
    if (traits.isTwoSeater) kind = canExtend && roll < 0.4 ? 'extend' : roll < 0.7 ? 'jink' : 'break';
    else if (t < 0.25) kind = roll < 0.6 ? 'break' : 'jink';
    else if (canExtend && traits.style === 'energy' && roll < 0.45) kind = 'extend';
    else kind = 'break';
  } else if (traits.isTwoSeater) kind = roll < 0.6 ? 'jink' : 'break';
  else if (t < 0.25) kind = roll < 0.45 ? 'break' : roll < 0.75 ? 'jink' : 'extend';
  else if (traits.style === 'energy' && agl > 700 && roll < 0.45) kind = 'spiral';
  else if (agl > 1000 && t > 0.6 && roll < 0.2) kind = 'split-s';
  else if (roll < 0.65) kind = 'break';
  else if (roll < 0.85) kind = 'climbing-turn';
  else kind = 'jink';
  const duration = kind === 'split-s' ? 6 : kind === 'extend' ? 8 : kind === 'jink' ? 5 : 3 + 2 * rng();
  return {
    kind,
    side,
    start: now,
    until: now + duration,
    heading0: headingOf(f),
    nextReverse: now + 1 + rng(),
    low,
    homeDir: homeDir ? homeDir.clone().setY(0).normalize() : undefined,
  };
}

/** Fill `out` with the steering for the manoeuvre at time `now`. */
export function maneuverSteer(m: Maneuver, self: AircraftEntity, attacker: AircraftEntity | undefined, now: number, rng: () => number, out: SteerCommand): void {
  const v = self.state.velocity;
  const fh = new Vector3(v.x, 0, v.z);
  if (fh.lengthSq() < 1) forwardOf(self.state.orientation, fh).setY(0);
  if (fh.lengthSq() < 1e-6) fh.set(0, 0, -1);
  fh.normalize();
  // Right of the horizontal track (not of the wing, which flips past 90 deg of bank).
  const rh = new Vector3(-fh.z, 0, fh.x);
  out.speed = Infinity;
  out.aim = false;
  out.aggression = 1.5;
  out.maxG = undefined;
  // Over-banking is gated by the autopilot on height above ground (sinkOk).
  out.maxPerformance = m.kind === 'break' || m.kind === 'spiral' || m.kind === 'split-s';
  switch (m.kind) {
    case 'break':
      // Level (a touch nose-high) near the ground; slightly descending otherwise.
      out.dir.copy(rh).multiplyScalar(m.side).addScaledVector(fh, m.low ? 0.25 : 0.15).add(new Vector3(0, m.low ? 0.03 : -0.08, 0));
      break;
    case 'climbing-turn':
      out.dir.copy(rh).multiplyScalar(m.side * 0.8).addScaledVector(fh, 0.4).add(new Vector3(0, 0.45, 0));
      break;
    case 'spiral':
      out.dir.copy(rh).multiplyScalar(m.side * 0.7).addScaledVector(fh, 0.4).add(new Vector3(0, -0.65, 0));
      break;
    case 'split-s': {
      const elapsed = now - m.start;
      if (elapsed < 3.5) {
        // Half-roll and pull through: aim down and back along the start heading.
        out.dir.copy(dirFromHeading(m.heading0)).multiplyScalar(-0.5).add(new Vector3(0, -1, 0));
      } else {
        out.dir.copy(dirFromHeading(m.heading0 + Math.PI));
      }
      break;
    }
    case 'jink':
      if (now > m.nextReverse) {
        m.side = m.side === 1 ? -1 : 1;
        m.nextReverse = now + 0.9 + 0.8 * rng();
      }
      out.dir
        .copy(rh)
        .multiplyScalar(m.side)
        .addScaledVector(fh, 0.45)
        .add(new Vector3(0, (rng() - 0.5) * (m.low ? 0.08 : 0.3), 0));
      out.aggression = 1.5;
      break;
    case 'extend': {
      const away = attacker ? _rel.copy(self.state.position).sub(attacker.state.position).setY(0).normalize() : fh.clone();
      if (m.low && m.homeDir) {
        // Along the deck toward our lines, angled off the attacker's line of fire.
        out.dir.copy(m.homeDir).multiplyScalar(0.7).addScaledVector(away, 0.3).setY(0).normalize().add(new Vector3(0, 0.02, 0));
      } else {
        out.dir.copy(away).add(new Vector3(0, m.low ? 0.02 : -0.12, 0));
      }
      break;
    }
  }
}
