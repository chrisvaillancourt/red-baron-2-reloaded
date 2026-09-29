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
 *
 * Escalation (TACTICS_FLAGS.escalateDefence, D-085): every turning manoeuvre turns toward
 * the attacker, so repeating them chains into a circle he can sit in. Measured against the
 * veteran autoplayer and a human-like pursuer, the hard break, the spiral and the brake
 * turn get a defender hit least (jinks, climbs, straight dives and scissors against a
 * better turner all get him hit more), so once a manoeuvre has not shaken the same attacker
 * he keeps turning: a veteran or ace closed on fast from close behind flies a brake turn
 * (above 500 m, throttled back to make the attacker overshoot); a pilot two manoeuvres in
 * reverses his turn while the attacker is lagging (TACTICS_FLAGS.defenceReversal), which
 * breaks up the circle at no measured cost; otherwise a spiral with plenty of height to
 * spare (never two running), else the break. Pilots above novice don't jink with a man
 * close behind. None of this applies on the way home: a hurt pilot's job is to get there,
 * or into cloud. TACTICS_FLAGS.defenceLadder swaps in the brief's ladder (scissors, dive
 * and zoom, climbing spiral, split-S by airframe) for A/B runs; it measured worst.
 */
import { Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import { dirFromHeading, forwardOf, headingOf } from './math';
import type { SkillProfile } from './skill';
import { traitsFor, type AircraftTraits } from './traits';
import type { SteerCommand } from './autopilot';

export type ManeuverKind = 'break' | 'climbing-turn' | 'split-s' | 'spiral' | 'jink' | 'extend' | 'brake-turn' | 'scissors' | 'dive-zoom' | 'reversal';

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
  /** Brake turn: target airspeed, m/s (the autopilot's speed floor still applies). */
  brakeSpeed?: number;
  /** Dive-and-zoom: pull out and zoom once this airspeed (m/s) is reached. */
  zoomAt?: number;
  /** Dive-and-zoom: mission time the zoom began. */
  zoomSince?: number;
}

/**
 * Which escalation (TACTICS_FLAGS): `brake` keeps turning (brake turn, spiral, break);
 * `ladder` changes direction or plane by airframe (scissors, dive and zoom, climbing spiral,
 * split-S; the wave-9 brief's ladder, kept for A/B runs).
 */
export type DefenceMode = 'brake' | 'ladder';

/**
 * Escalating defence is on (TACTICS_FLAGS.escalateDefence). `level` counts manoeuvres flown
 * in a row against the same attacker: 0 = a fresh threat, 1 = the last one didn't shake him.
 */
export interface Escalation {
  level: number;
  /** The manoeuvre he just flew, if any. */
  lastKind?: ManeuverKind;
  /** Default `brake`. */
  mode?: DefenceMode;
  /**
   * Brake mode: a pilot still not free after REVERSAL_LEVEL manoeuvres reverses his turn
   * when the attacker's nose has dropped behind him.
   */
  reversal?: boolean;
}

/** Brake turn: skill above this (veterans, aces), attacker inside this range (m), closing faster than this (m/s). */
const BRAKE_T = 0.45;
const BRAKE_RANGE_M = 300;
const BRAKE_CLOSING_MS = 2;
/** No brake turn below this height above ground (m): measured worse than the break low down. */
const BRAKE_AGL = 500;
/**
 * Escalation.reversal: after this many manoeuvres in a row that haven't shaken him, and only
 * while the attacker is lagging (his nose behind us, no shot), break the other way. Reversing
 * whenever a third manoeuvre came up got a defender hit twice as often per second of
 * tail-hold against the human-like pursuer; gated on lag it costs nothing measurable and
 * still breaks up the circle (docs/ai.md "Wave 9: defence").
 */
const REVERSAL_LEVEL = 2;
/** The attacker counts as lagging with his nose this far off us, rad (and behind us). */
const LAG_RAD = (10 * Math.PI) / 180;
/**
 * Escalate to a descending spiral only above this height above ground (m), and never twice
 * running: chained spirals took escalated fights down ~2.6 km a run and dragged pursuers
 * into the ground and the flak (docs/ai.md "Wave 9: defence").
 */
const SPIRAL_AGL = 1500;
/** With an enemy this close behind (m), pilots above novice don't jink (measured the worst defence). */
const NO_JINK_RANGE_M = 400;
/** Ladder: height above ground (m) for a dive and zoom, a split-S; no scissors below SCISSORS_AGL (D-060). */
const DIVE_AGL = 800;
const SPLIT_S_AGL = 1000;
const SCISSORS_AGL = 500;
/** Ladder: a dive only opens a gap he hasn't closed, from this range (m) out. */
const DIVE_GAP_M = 300;
/** Ladder: out-dives him by this much safe dive speed (m/s; the D.V does not, D-075); out-climbs by this many minutes to 3,000 m. */
const OUT_DIVE_MS = 4;
const OUT_CLIMB_MIN = 1;

const _f = new Vector3();
const _r = new Vector3();
const _rel = new Vector3();
const _v = new Vector3();

export function chooseDefensive(
  self: AircraftEntity,
  attacker: AircraftEntity | undefined,
  traits: AircraftTraits,
  profile: SkillProfile,
  agl: number,
  now: number,
  rng: () => number,
  homeDir?: Vector3,
  /** Experienced pilots turn up into an attacker diving from above. */
  meetBounce = false,
  /** Set when the same attacker survived the last manoeuvre and escalation is on. */
  escalation?: Escalation,
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
  // Closing speed of the attacker (m/s, positive = closing).
  const closing = attacker && range < Infinity ? -_rel.dot(_v.copy(attacker.state.velocity).sub(self.state.velocity)) / Math.max(range, 1) : 0;
  const skilled = !!escalation && t >= 0.25 && !traits.isTwoSeater && !!attacker;
  const ladder = skilled && escalation!.mode === 'ladder';
  if (ladder && escalation!.level >= 1) {
    kind = ladderStep(self, attacker!, traits, profile, agl, range, homeDir);
    // A reversal is the point of the ladder: turn away from the attacker's side.
    if (kind === 'scissors') side = side === 1 ? -1 : 1;
  } else if (skilled && escalation!.level >= 1) {
    kind = escalate(profile, agl, range, closing, escalation!, lagging(self, attacker!));
    // Reverse: break away from the side he sits on, so his lead is suddenly wrong.
    if (kind === 'reversal') side = side === 1 ? -1 : 1;
  } else if (low) {
    // Extending only works with a lead: a pursuer inside ~450 m just follows and shoots.
    const faster = !attacker || self.state.airspeed >= attacker.state.airspeed - 2;
    const canExtend = homeDir !== undefined && faster && range > 450;
    if (traits.isTwoSeater) kind = canExtend && roll < 0.4 ? 'extend' : roll < 0.7 ? 'jink' : 'break';
    else if (t < 0.25) kind = roll < 0.6 ? 'break' : 'jink';
    else if (canExtend && traits.style === 'energy' && roll < 0.45) kind = 'extend';
    else kind = 'break';
  } else if (meetBounce && attacker && t > 0.6 && !traits.isTwoSeater && attacker.state.position.y > self.state.position.y + 150 && range < 1000) {
    // Dicta Boelcke: "if your opponent dives on you, do not try to evade his onslaught,
    // but fly to meet it": a climbing turn into a bounce from above (often out of the sun).
    kind = 'climbing-turn';
  } else if (traits.isTwoSeater) kind = roll < 0.6 ? 'jink' : 'break';
  else if (t < 0.25) kind = roll < 0.45 ? 'break' : roll < 0.75 ? 'jink' : 'extend';
  else if (traits.style === 'energy' && agl > 700 && roll < 0.45) kind = 'spiral';
  else if (agl > 1000 && t > 0.6 && roll < 0.2) kind = 'split-s';
  else if (roll < 0.65) kind = 'break';
  else if (roll < 0.85) kind = 'climbing-turn';
  else kind = 'jink';
  // A jink with a man close behind keeps the aircraft nearly straight: the worst defence
  // measured. Pilots above novice turn instead when escalation is on.
  if (skilled && !ladder && kind === 'jink' && range < NO_JINK_RANGE_M) kind = agl > SPIRAL_AGL ? 'spiral' : 'break';
  const duration =
    kind === 'split-s' ? 6 : kind === 'extend' ? 8 : kind === 'jink' ? 5 : kind === 'brake-turn' ? 4 : kind === 'scissors' ? 6 : kind === 'dive-zoom' ? 12 : kind === 'reversal' ? 2.5 : 3 + 2 * rng();
  return {
    kind,
    side,
    start: now,
    until: now + duration,
    heading0: headingOf(f),
    nextReverse: now + 1 + rng(),
    low,
    homeDir: homeDir ? homeDir.clone().setY(0).normalize() : undefined,
    ...(kind === 'brake-turn' ? { brakeSpeed: traits.stallSpeed * 1.45 } : {}),
    ...(kind === 'dive-zoom' ? { zoomAt: Math.min(traits.maxSafeDiveSpeed * 0.95, self.state.airspeed + 25) } : {}),
  };
}

/** Is `attacker` in lag, his nose pointing more than LAG_RAD behind us (no shot)? */
function lagging(self: AircraftEntity, attacker: AircraftEntity): boolean {
  const af = forwardOf(attacker.state.orientation, _v);
  const toUs = _rel.copy(self.state.position).sub(attacker.state.position).normalize();
  const off = Math.acos(Math.max(-1, Math.min(1, af.dot(toUs))));
  if (off < LAG_RAD) return false;
  // Pointing behind us: his nose's miss lies against our direction of flight.
  const v = self.state.velocity;
  return af.dot(v) - toUs.dot(v) * af.dot(toUs) < 0;
}

/**
 * The ladder (DefenceMode `ladder`): change direction or plane by airframe once a manoeuvre
 * hasn't shaken him. Scissors when he is close and we roll and turn about as well as he does,
 * a dive and zoom when we out-dive him and have a gap, a climbing spiral when we out-climb
 * him, a split-S with height to spare (veterans and aces), else a weave. Below 500 m (D-060:
 * no scissors low down) climb out, extend along the deck, or weave.
 */
function ladderStep(self: AircraftEntity, attacker: AircraftEntity, traits: AircraftTraits, profile: SkillProfile, agl: number, range: number, homeDir?: Vector3): ManeuverKind {
  const me = self.spec.performance;
  const him = attacker.spec.performance;
  const his = traitsFor(attacker.spec);
  const outClimbs = me.climbTo3000mMin <= him.climbTo3000mMin - OUT_CLIMB_MIN;
  const outDives = traits.maxSafeDiveSpeed >= his.maxSafeDiveSpeed + OUT_DIVE_MS;
  const faster = traits.maxSpeed >= his.maxSpeed + 2;
  if (agl < SCISSORS_AGL) {
    if (outClimbs && self.state.airspeed > traits.bestClimbSpeed + 6) return 'climbing-turn';
    if (agl < LOW_AGL && faster && homeDir) return 'extend';
    return 'jink';
  }
  // Scissors favour the pilot who rolls as fast and can fly slower (lighter wing loading).
  const scissorsOk = me.rollRate >= 0.8 * him.rollRate && me.massLoaded / me.wingArea <= (him.massLoaded / him.wingArea) * 1.1;
  if (range < DIVE_GAP_M && scissorsOk) return 'scissors';
  if (outDives && agl > DIVE_AGL && range >= DIVE_GAP_M) return 'dive-zoom';
  if (outClimbs) return 'climbing-turn';
  if (profile.t > 0.6 && agl > SPLIT_S_AGL) return 'split-s';
  return scissorsOk ? 'scissors' : 'jink';
}

/**
 * The escalated manoeuvre for a pilot the same attacker is still sitting behind. Measured
 * (docs/ai.md "Wave 9: defence"): the hard break and the descending spiral are the turns
 * that get a defender hit least, so he keeps turning, and a veteran or ace closed on fast
 * from close behind throttles back in the turn to make the attacker overshoot.
 */
function escalate(profile: SkillProfile, agl: number, range: number, closing: number, e: Escalation, lag: boolean): ManeuverKind {
  if (profile.t > BRAKE_T && agl > BRAKE_AGL && range < BRAKE_RANGE_M && closing > BRAKE_CLOSING_MS) return 'brake-turn';
  if (e.reversal && e.level >= REVERSAL_LEVEL && lag && e.lastKind !== 'reversal') return 'reversal';
  return agl > SPIRAL_AGL && e.lastKind !== 'spiral' ? 'spiral' : 'break';
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
  out.maxPerformance = m.kind === 'break' || m.kind === 'reversal' || m.kind === 'spiral' || m.kind === 'split-s';
  switch (m.kind) {
    case 'break':
    case 'reversal':
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
    case 'brake-turn':
      // The break, throttled back and a touch nose-high: he closes too fast to hold the
      // turn inside us and slides past, and we reverse onto him.
      out.dir.copy(rh).multiplyScalar(m.side).addScaledVector(fh, 0.15).add(new Vector3(0, m.low ? 0.03 : 0.04, 0));
      out.speed = m.brakeSpeed ?? Infinity;
      out.maxPerformance = true;
      break;
    case 'scissors': {
      // Hard reversals every ~2 s, nose a touch high to bleed speed and make him overshoot.
      if (now > m.nextReverse) {
        m.side = m.side === 1 ? -1 : 1;
        m.nextReverse = now + 1.8 + 0.6 * rng();
      }
      out.dir.copy(rh).multiplyScalar(m.side).addScaledVector(fh, 0.2).add(new Vector3(0, 0.08, 0));
      out.maxPerformance = true;
      break;
    }
    case 'dive-zoom': {
      // Push over into a steep dive off his line, then zoom once fast: a heavier, cleaner
      // airframe gains on him going down and keeps it coming up.
      const away = attacker ? _rel.copy(self.state.position).sub(attacker.state.position).setY(0).normalize() : fh.clone();
      if (m.zoomSince == null && self.state.airspeed >= (m.zoomAt ?? Infinity)) m.zoomSince = now;
      if (m.zoomSince == null) {
        out.dir.copy(fh).multiplyScalar(0.6).addScaledVector(away, 0.4).normalize().add(new Vector3(0, -0.75, 0));
      } else {
        out.dir.copy(fh).add(new Vector3(0, 0.8, 0));
        out.maxG = 4;
        if (now - m.zoomSince > 4) m.until = Math.min(m.until, now);
      }
      break;
    }
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
