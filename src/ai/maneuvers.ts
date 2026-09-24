/**
 * Scripted defensive manoeuvres. Each produces a desired flight-path
 * direction relative to the current attitude, so a "break" keeps turning
 * hard for its duration rather than aiming at a fixed point.
 */
import { Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import { dirFromHeading, forwardOf, headingOf } from './math';
import type { SkillProfile } from './skill';
import type { AircraftTraits } from './traits';
import type { SteerCommand } from './autopilot';

export type ManeuverKind = 'break' | 'climbing-turn' | 'split-s' | 'spiral' | 'jink' | 'extend';

export interface Maneuver {
  kind: ManeuverKind;
  /** +1 = turn right, -1 = turn left. */
  side: 1 | -1;
  start: number;
  until: number;
  /** Heading at the start (split-S / extend reference). */
  heading0: number;
  nextReverse: number;
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
): Maneuver {
  const f = forwardOf(self.state.orientation, _f);
  const r = _r.set(-f.z, 0, f.x).normalize();
  let side: 1 | -1 = rng() < 0.5 ? 1 : -1;
  if (attacker) {
    _rel.copy(attacker.state.position).sub(self.state.position);
    // Turn toward the attacker's side to maximise angle-off and force an overshoot.
    side = _rel.dot(r) >= 0 ? 1 : -1;
  }
  // Camel/Dr.I-style torque: rotary types break right more readily.
  if (self.spec.performance.engineType === 'rotary' && rng() < 0.3) side = 1;
  const t = profile.t;
  const roll = rng();
  let kind: ManeuverKind;
  if (traits.isTwoSeater) kind = roll < 0.6 ? 'jink' : 'break';
  else if (t < 0.25) kind = roll < 0.45 ? 'break' : roll < 0.75 ? 'jink' : 'extend';
  else if (traits.style === 'energy' && agl > 700 && roll < 0.45) kind = 'spiral';
  else if (agl > 1000 && t > 0.6 && roll < 0.2) kind = 'split-s';
  else if (roll < 0.65) kind = 'break';
  else if (roll < 0.85) kind = 'climbing-turn';
  else kind = 'jink';
  const duration = kind === 'split-s' ? 6 : kind === 'extend' ? 8 : kind === 'jink' ? 5 : 3 + 2 * rng();
  return { kind, side, start: now, until: now + duration, heading0: headingOf(f), nextReverse: now + 1 + rng() };
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
  out.maxPerformance = m.kind === 'break' || m.kind === 'spiral' || m.kind === 'split-s';
  switch (m.kind) {
    case 'break':
      out.dir.copy(rh).multiplyScalar(m.side).addScaledVector(fh, 0.15).add(new Vector3(0, -0.08, 0));
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
      out.dir.copy(rh).multiplyScalar(m.side).addScaledVector(fh, 0.45).add(new Vector3(0, (rng() - 0.5) * 0.3, 0));
      out.aggression = 1.5;
      break;
    case 'extend': {
      const away = attacker ? _rel.copy(self.state.position).sub(attacker.state.position).setY(0).normalize() : fh.clone();
      out.dir.copy(away).add(new Vector3(0, -0.12, 0));
      break;
    }
  }
}
