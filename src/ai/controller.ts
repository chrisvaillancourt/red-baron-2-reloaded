
/** Fixed-gun rounds left as a fraction of a full load (1 = full). */
export function fixedAmmoFraction(ac: AircraftEntity): number {
  let full = 0;
  for (const m of ac.spec.guns) if (m.mount !== 'flexible') full += m.rounds * (1 + m.spareDrums);
  return full > 0 ? fixedAmmo(ac) / full : 0;
}
/**
 * AIPilot: the per-aircraft AI controller.
 *
 *   mission layer  (waypoints, patrol, formation, escort, balloon/ground attack, RTB, landing)
 *        |  may be pre-empted by
 *   tactical layer (target selection, pursuit/gunnery, boom-and-zoom extend, defence)
 *        |  both emit a SteerCommand
 *   safety         (collision avoidance) -> Autopilot (stick/rudder/throttle, stall & ground protection)
 *   weapons        (burst discipline, jam clearing, rear-gunner target via injected hook)
 */
import { Vector3 } from 'three';
import type { AIController, WingmanCommand, WorldQuery } from '../core/interfaces';
import type {
  AircraftEntity,
  BalloonEntity,
  CrewStation,
  CrewStationId,
  FlightRole,
  GroundTargetEntity,
  MissionFlight,
  RealismSettings,
  SkillLevel,
  Waypoint,
} from '../core/types';
import { getAerodrome } from '../data/aerodromes';
import { Autopilot, type SteerCommand } from './autopilot';
import { angularRadius, leadSolution, type LeadSolution } from './gunnery';
import { angleBetween, clamp, DEG, forwardOf, headingOf, makeRng, upOf, rightOf, wrapPi } from './math';
import { HumanAim, type HumanPilotParams } from './humanAim';
import { chooseDefensive, DefenceStreak, LOW_AGL, maneuverSteer, type DefenceMode, type Maneuver } from './maneuvers';
import {
  formationOffset,
  formationSteer,
  homeDirection,
  nearestFriendlyAerodrome,
  orbitSteer,
  planLanding,
  toPointSteer,
  type LandingPlan,
  type LandingStage,
} from './navigation';
import { cloudHides, forgetPerception, isAlive, isAttacking, likelySpottedBy, Perception, sunAngle, threatLevel } from './perception';
import { makeSkillProfile, skillValue, type SkillProfile } from './skill';
import { traitsFor, type AircraftTraits } from './traits';
import { aceTactics, attackSetupPoint, outTurnedBy, TACTICS_FLAGS, tacticsProfile, type TacticsProfile } from './tactics';
import type { AceTactics } from '../data/aces';
import { getCoefficients } from '../sim/coefficients';
import { getSimInternal } from '../sim/flightModel';
import { gunnerFacesForward } from '../sim/hitboxes';
import { getBombStats, predictBombImpact } from '../sim/bombs';
import { crewStations } from '../data/crew';
import { blindSpot, bodyDirection, bombsAboard, canBomb, isBomber, chooseAimTarget, crewAlive, gunnersOf, MAX_RUNS, RELEASE_CROSS_M, REVERSE_OUT_M, RUN_FACING, RUN_HOLD_S, RUN_MIN_TURN_IN_M, RUN_START_M, stationBearing, STICK_INTERVAL_S, TARGET_AREA_M } from './bombing';

export interface AIControllerOptions {
  role: FlightRole;
  task: MissionFlight['task'];
  skill: SkillLevel;
  /** Entity id of the flight leader (omit for the leader; inferred from flightId if absent). */
  leaderId?: number;
  /** 1-based slot in the leader's vic (odd = right, even = left). */
  formationSlot?: number;
  realism: RealismSettings;
  /**
   * Hook into src/sim combat: point this aircraft's flexible gun(s) at a target (src/sim
   * `setGunnerTarget`). With a station, only the man at that station (several gunners aboard).
   */
  setGunnerTarget?: (ac: AircraftEntity, targetId: number | null, station?: CrewStationId) => void;
  /** Where to land when the mission is done (defaults to nearest friendly field). */
  homeAerodromeId?: string;
  /** RNG seed (defaults to the entity id) for reproducible behaviour. */
  seed?: number;
  /**
   * Control law: `sim` (default) inverts src/sim's stick laws using its coefficients;
   * `generic` is a model-agnostic PID law (used with the point-mass test model).
   */
  controlLaw?: 'sim' | 'generic';
  /** Steer clear of other aircraft (default true). False stands in for a human pilot in tests. */
  avoidCollisions?: boolean;
  /** Named ace flying this aircraft (src/data/aces.ts): sets his tactical signature. */
  aceId?: string;
  /** Tactical signature override (tests); defaults to the ace's own, else generic for the skill. */
  tactics?: AceTactics;
  /**
   * Aim and fire like a human mouse-aim player (humanAim.ts) instead of the skill's computed
   * lead. The autoplayer's human-like pursuer; tactics are still the AI's own.
   */
  human?: HumanPilotParams;
}

/** Boom-and-zoom cycle against one target: set up above, dive through, zoom away. */
type BoomZoomStage = 'position' | 'attack' | 'zoom';

export type AIPhase =
  | 'takeoff'
  | 'mission'
  | 'formation'
  | 'escort'
  | 'patrol'
  | 'engage'
  | 'extend'
  | 'defend'
  | 'attack-balloon'
  | 'attack-ground'
  /** A bomber's straight and level run over its 'bomb' waypoint (bombing.ts). */
  | 'bomb-run'
  | 'rtb'
  | 'landing'
  | 'landed'
  | 'out';

export interface AIStats {
  /** Seconds with a true (noise-free) guns solution on the current target. */
  gunsSolutionTime: number;
  firingTime: number;
  defendTime: number;
  /** Seconds in engage/extend (fighting), and of those, seconds in stall recovery. */
  engageTime: number;
  engageRecoverTime: number;
  /** Seconds actually stalled (state.stalled), any phase. */
  stalledTime: number;
}

/** Controllers by entity, so wingmen can see what their leader is doing. */
const REGISTRY = new WeakMap<AircraftEntity, AIPilot>();

/** RTB reasons that are a choice, not a necessity: a fit fighter still fights back. */
const VOLUNTARY_RTB = new Set(['ordered home', 'mission complete', 'escort complete']);

/** Seconds of closure at which an attacker breaks off a head-on or overtaking pass. */
const BREAK_LEAD_S = 1.8;
/** Seconds of full-g break away from the merge before the extension. */
const BREAK_S = 0.8;
/** A bomber formation's leader flies at this fraction of his top speed (a lone machine cruises at 0.8). */
const BOMBER_FORMATION_SPEED = 0.72;
/** Shortest stay inside a refuge cloud, s (plus up to 15 s). */
const REFUGE_MIN_S = 25;
/** Largest circle flown round a refuge cloud's core, m (an overcast deck has no edge). */
const REFUGE_ORBIT_MAX_M = 250;

/** The escalation TACTICS_FLAGS selects (maneuvers.ts). */
function defenceMode(): DefenceMode {
  return TACTICS_FLAGS.defenceLadder ? 'ladder' : 'brake';
}

export function getAIPilot(ac: AircraftEntity): AIPilot | undefined {
  return REGISTRY.get(ac);
}

/**
 * Forget the controller that flew `ac`, when the player takes the controls back from the AI
 * that flew while he worked a gun (src/game). Other AIs then stop reading its frozen phase and
 * target, and nothing reads its contacts as the player's.
 */
export function releaseAIPilot(ac: AircraftEntity): void {
  REGISTRY.delete(ac);
  forgetPerception(ac);
}

/**
 * Which way `self` splits from `other` when they close dead ahead: +1 up its lift line, -1
 * down. The two always split opposite ways. Every AI takes the up side against the player's
 * aircraft, assuming the human won't dodge; when an AI flies the player's aircraft (the
 * autoplayer, or the player at a gun) it takes the down side, so they don't both climb.
 */
export function splitSide(self: AircraftEntity, other: AircraftEntity): 1 | -1 {
  if (self.controller === 'player' && other.controller !== 'player') return -1;
  return other.controller === 'player' || self.id < other.id ? 1 : -1;
}

type AttackStage = 'approach' | 'run' | 'pullout';

const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _tmp3 = new Vector3();
const _rel = new Vector3();
const _up = new Vector3(0, 1, 0);
const _collisionLift = new Vector3();

export class AIPilot implements AIController {
  readonly entityId: number;
  debugState = 'init';
  phase: AIPhase = 'mission';
  readonly stats: AIStats = { gunsSolutionTime: 0, firingTime: 0, defendTime: 0, engageTime: 0, engageRecoverTime: 0, stalledTime: 0 };
  readonly traits: AircraftTraits;
  readonly profile: SkillProfile;
  readonly autopilot: Autopilot;
  readonly tactics: TacticsProfile;

  private readonly opts: AIControllerOptions;
  private readonly perception: Perception;
  private readonly rng: () => number;
  private order: WingmanCommand | 'default' = 'default';
  private orderTargetId: number | null = null;

  private now = 0;
  /** Take-off state: runway heading and when this aircraft may start its roll (wingmen wait). */
  private takeoffHeading = 0;
  private takeoffStart = -1;
  private wpIndex = 0;
  private patrolUntil = -1;
  private wpStarted = -1;
  targetId: number | null = null;
  private maneuver: Maneuver | null = null;
  private threatSince = -1;
  private threatId: number | null = null;
  private fixatedUntil = 0;
  private burstUntil = 0;
  private burstNext = 0;
  private nextJamPress = 0;
  private lastDamage = 0;
  private hitAt = -100;
  private extendUntil = 0;
  private rtbReason = '';
  /** RTB reason to resume after fighting off an attacker on the way home. */
  private resumeRtb = '';
  private landing: LandingPlan | null = null;
  landingStage: LandingStage = 'approach';
  private gunnerTarget: number | null = null;
  private attackStage: AttackStage = 'approach';
  /** Strafing / balloon passes made at the current attack waypoint. */
  private attackPasses = 0;
  private breakDir = new Vector3(0, 1, 0);
  private breakUntil = -1;
  private attackStageUntil = 0;
  /** +1 / -1: which way a balloon pull-out breaks. */
  private pulloutSide = 1;
  private attackObjId: number | null = null;
  private attackPhaseStarted = -1;
  private leadScale = 1;
  private noise = new Vector3();
  private prevTargetVel = new Vector3();
  private prevTargetId: number | null = null;
  private targetAcc = new Vector3();
  private missionDone = false;
  private bz: { stage: BoomZoomStage; since: number; targetId: number } | null = null;
  /** Setting up an unseen attack on this target since this time. */
  private stalk: { targetId: number; since: number } | null = null;
  /** A cloud to hide in on the way home (damaged, pursued), and until when to stay in it. */
  private refuge: { pos: Vector3; radius: number; until: number; turn: number } | null = null;
  private refugeCheck = 0;
  /** Defensive manoeuvres flown in a row against one attacker (escalation). */
  private readonly defenceStreak = new DefenceStreak();
  private loiter: Vector3 | null = null;
  /** The bomb run at the current 'bomb' waypoint (a formation leader, or a bomber alone). */
  private bombRun: { stage: 'approach' | 'run' | 'reverse'; targetId: number | null; runs: number; dir: Vector3; alt: number } | null = null;
  /** A stick being released: bombs still to go in it, and when the next goes. */
  private stick: { left: number; next: number } | null = null;
  /** The formation leader's bombs dropped when last seen: a bomber releases on his leader's. */
  private leaderDrops: { id: number; dropped: number } | null = null;
  /** Released on the leader: where his first bomb will fall, his track, and until when to wait. */
  private onLeader: { x: number; z: number; dir: Vector3; until: number } | null = null;
  /** After his stick, the leader holds the run for the bombers releasing on him (holdRun). */
  private runHold: { dir: Vector3; alt: number; until: number } | null = null;
  /** Several gunners aboard: each man's target and the station it was set on. */
  private readonly manTargets = new Map<number, { id: number; station: CrewStationId }>();
  private readonly steer: SteerCommand = { dir: new Vector3(0, 0, -1), speed: Infinity };
  private readonly lead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };
  private readonly trueLead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };
  /** Human-like aim (opts.human), else null. */
  private readonly human: HumanAim | null;
  /** The last update's time step, s. */
  private dt = 0;

  constructor(ac: AircraftEntity, opts: AIControllerOptions) {
    this.entityId = ac.id;
    this.opts = opts;
    this.traits = traitsFor(ac.spec);
    this.profile = makeSkillProfile(skillValue(opts.skill, opts.role, opts.realism));
    this.perception = new Perception(this.profile, ac);
    this.tactics = tacticsProfile(this.profile.t, opts.tactics ?? aceTactics(opts.aceId));
    this.rng = makeRng(opts.seed ?? ac.id * 7919 + 13);
    // Its own stream, so the pilot's decisions draw the same numbers either way.
    this.human = opts.human ? new HumanAim(opts.human, makeRng((opts.seed ?? ac.id * 7919 + 13) ^ 0x5eed)) : null;
    this.autopilot = new Autopilot(
      this.traits,
      this.profile.maxG,
      this.profile.groundMargin,
      ac.spec.performance.rollRate,
      ac.spec.performance.pitchRate,
      opts.controlLaw === 'generic' ? null : getCoefficients(ac.spec),
    );
    this.autopilot.diveCaution = this.profile.t;
    this.lastDamage = damageSum(ac);
    // Parked on a field at mission start: take off first.
    if (ac.state.onGround && ac.state.airspeed < 5) {
      this.phase = 'takeoff';
      this.takeoffHeading = headingOf(forwardOf(ac.state.orientation, _tmp));
    }
    REGISTRY.set(ac, this);
  }

  command(cmd: WingmanCommand, targetId?: number): void {
    this.order = cmd;
    this.orderTargetId = targetId ?? null;
    if (cmd === 'attack-my-target' && targetId != null) this.targetId = targetId;
    if (cmd === 'form-up' || cmd === 'cover-me') this.targetId = null;
    if (cmd === 'return-home') this.startRtb('ordered home');
  }

  // =====================================================================
  update(self: AircraftEntity, world: WorldQuery, dt: number): void {
    this.now = world.time;
    this.dt = dt;
    const c = self.controls;
    if (!isAlive(self)) {
      this.phase = 'out';
      c.fireGuns = false;
      c.throttle = 0;
      c.pitch = c.roll = c.yaw = 0;
      this.debugState = 'out';
      return;
    }
    if (this.phase === 'landed') {
      c.fireGuns = false;
      c.throttle = 0;
      c.pitch = 0.3;
      c.roll = c.yaw = 0;
      this.debugState = 'landed';
      return;
    }
    if (this.phase === 'takeoff') {
      this.perception.sweep(self, world, this.rng);
      if (this.flyTakeoff(self, world, dt)) {
        this.debugState = `takeoff${self.state.onGround ? ' roll' : ' climb'}`;
        return;
      }
      this.phase = 'mission';
    }

    this.perception.sweep(self, world, this.rng);
    this.checkDamage(self, world);
    this.checkDisengage(self, world);
    this.decide(self, world);

    const steer = this.steer;
    steer.aim = false;
    steer.maxG = undefined;
    steer.minAgl = undefined;
    steer.aggression = 1;
    steer.lowLevel = false;
    steer.minSpeed = undefined;
    steer.maxPerformance = false;
    steer.landing = false;
    steer.speed = Infinity;
    this.computeSteer(self, world, dt, steer);
    // A bomber leading a formation flies slower than a lone machine, so his formation can keep station.
    if (this.opts.task === 'bomb' && this.phase !== 'landing' && this.phase !== 'defend' && this.leadsFormation(self, world)) steer.speed = Math.min(steer.speed, this.traits.maxSpeed * BOMBER_FORMATION_SPEED);
    if (this.opts.avoidCollisions !== false) this.avoidCollisions(self, world, steer);
    this.autopilot.fly(self, steer, world, dt);

    this.weapons(self, world, dt);
    this.gunner(self, world);
    this.releaseBombs(self, world);
    if (this.phase === 'defend') this.stats.defendTime += dt;
    if (this.phase === 'engage' || this.phase === 'extend') {
      this.stats.engageTime += dt;
      if (this.autopilot.recovering) this.stats.engageRecoverTime += dt;
    }
    if (self.state.stalled) this.stats.stalledTime += dt;
    this.debugState = `${this.phase}${this.targetId != null ? ` #${this.targetId}` : ''}${this.maneuver ? ` ${this.maneuver.kind}` : ''}${this.autopilot.recovering ? ' recover' : ''}${this.autopilot.groundEmergency ? ' pull-up' : ''}`;
  }

  /**
   * Take-off from a grass field (src/sim ground model): full throttle, wings level, rudder
   * holds the runway heading, and the stick holds the fuselage level (tail up) until
   * 1.2 Vs, then rotates. Too much forward stick noses the aircraft over, so the pitch
   * loop targets a slightly nose-up attitude with rate damping. After lift-off it climbs
   * straight ahead at best-climb speed to ~120 m AGL. Wingmen wait a few seconds per slot
   * so the flight doesn't collide on the strip. Returns false when complete.
   */
  private flyTakeoff(self: AircraftEntity, world: WorldQuery, dt: number): boolean {
    const s = self.state;
    const c = self.controls;
    c.fireGuns = false;
    c.clearJam = false;
    c.blip = false;
    if (this.takeoffStart < 0) {
      const leader = this.resolveLeader(self, world);
      const slot = leader ? this.formationSlot(self, world, leader) : 0;
      this.takeoffStart = this.now + slot * 6;
    }
    if (this.now < this.takeoffStart) {
      c.throttle = 0;
      c.pitch = 0.3;
      c.roll = c.yaw = 0;
      return true;
    }
    if (this.now - this.takeoffStart > 150) return false; // give up managing it; the mission layer takes over
    const f = forwardOf(s.orientation, _tmp);
    const hErr = wrapPi(this.takeoffHeading - headingOf(f));
    const bank = Autopilot.bankAngle(self);
    const rollRate = -s.angularVelocity.z; // + = rolling right
    const yawRate = -s.angularVelocity.y; // + = yawing right
    const agl = s.heightAboveGround;
    c.throttle = 1;
    if (s.onGround || agl < 6) {
      c.roll = clamp(-bank * 2 - rollRate * 0.4, -1, 1);
      c.yaw = clamp(hErr * 3 - yawRate * 0.8, -1, 1);
      const pitchAng = Math.asin(clamp(f.y, -1, 1));
      c.pitch = s.airspeed < this.traits.stallSpeed * 1.2 ? clamp((0.02 - pitchAng) * 5 - s.angularVelocity.x, -1, 1) : 0.3;
      return true;
    }
    if (agl > 120) return false;
    const steer = this.steer;
    steer.dir.set(Math.sin(this.takeoffHeading), 0.15, -Math.cos(this.takeoffHeading));
    steer.speed = this.traits.bestClimbSpeed * 1.1;
    steer.aim = false;
    steer.maxG = 2;
    steer.minAgl = 20;
    steer.lowLevel = true;
    steer.aggression = 1;
    steer.minSpeed = undefined;
    steer.maxPerformance = false;
    steer.landing = false;
    this.autopilot.fly(self, steer, world, dt);
    return true;
  }

  // =====================================================================
  // Perception-driven state
  // =====================================================================

  private checkDamage(self: AircraftEntity, world: WorldQuery): void {
    const d = damageSum(self);
    if (d > this.lastDamage + 1e-6) {
      this.hitAt = this.now;
      const att = self.damage.lastAttackerId;
      if (att != null) {
        const e = world.getEntity(att);
        this.perception.notice(att, this.now, e?.kind === 'aircraft' ? e : undefined);
        if (e && e.kind === 'aircraft') this.threatId = att;
      }
    }
    this.lastDamage = d;
  }

  private checkDisengage(self: AircraftEntity, world: WorldQuery): void {
    if (this.phase === 'rtb' || this.phase === 'landing') return;
    const dm = self.damage;
    const z = dm.zones;
    const t = this.profile.t;
    let reason = '';
    if (dm.engineDead) reason = 'engine dead';
    else if (dm.onFire) reason = 'on fire';
    else if (z.engine > 0.5) reason = 'engine damaged';
    else if (z.leftWing > 0.5 || z.rightWing > 0.5 || z.tail > 0.5 || z.controls > 0.6) reason = 'airframe damaged';
    else if (dm.pilotWounded && (t < 0.7 || z.pilot > 0.5)) reason = 'wounded';
    else if (damageSum(self) > this.tactics.disengageDamage) reason = 'airframe damaged';
    else if (self.state.fuelL < 0.12 * self.spec.performance.fuelCapacityL) reason = 'low fuel';
    else if (this.traits.hasFixedGuns && this.opts.task !== 'recon' && this.opts.task !== 'bomb' && fixedAmmo(self) === 0) reason = 'out of ammunition';
    // A bomber hurt but still flying keeps his place in the formation, which is his best
    // protection and goes home when the job is done; only a failing engine, fire or fuel sends him off alone.
    if ((reason === 'wounded' || reason === 'airframe damaged') && this.holdsFormation(self, world)) reason = '';
    if (reason) this.startRtb(reason);
  }

  private startRtb(reason: string): void {
    if (this.phase === 'landing' || this.phase === 'landed') return;
    this.rtbReason = reason;
    this.phase = 'rtb';
    this.targetId = null;
  }

  private resolveLeader(self: AircraftEntity, world: WorldQuery): AircraftEntity | null {
    const lid = this.opts.leaderId;
    if (lid != null && lid !== self.id) {
      const l = world.getEntity(lid);
      if (l && l.kind === 'aircraft' && isAlive(l) && this.canLead(self, l)) return l;
    }
    let lowest: AircraftEntity | null = null;
    for (const a of world.aircraft) {
      if (a.flightId !== self.flightId || !isAlive(a)) continue;
      if (a !== self && !this.canLead(self, a)) continue;
      if (!lowest || a.id < lowest.id) lowest = a;
    }
    if (!lowest || lowest.id === self.id) return null;
    // A leader that has gone home/landed no longer leads.
    const lc = REGISTRY.get(lowest);
    if (lc && (lc.phase === 'landed' || lc.phase === 'landing') && this.phase !== 'rtb') return null;
    return lowest;
  }

  /**
   * A bomber doesn't follow a leader who has turned for home hurt before bombing (his bombs
   * still aboard): the next man leads the formation on to the target and home by its route,
   * and it doesn't take him back once it has bombed. A leader going home with the job done
   * still leads. Everyone else follows as before.
   */
  private canLead(_self: AircraftEntity, a: AircraftEntity): boolean {
    if (this.opts.task !== 'bomb') return true;
    const c = REGISTRY.get(a);
    return !(c && c.phase === 'rtb' && !VOLUNTARY_RTB.has(c.rtbReason) && bombsAboard(a) > 0);
  }

  /**
   * A bomber in formation holds it under attack instead of breaking (its gunners and its
   * formation-mates' cover it), and nobody jinks on the bomb run. Only a bomber alone, 600 m
   * or more from any of his flight, defends himself like a two-seater.
   */
  private holdsFormation(self: AircraftEntity, world: WorldQuery): boolean {
    if (this.opts.task !== 'bomb' || !TACTICS_FLAGS.bomberFormation) return false;
    if (this.phase === 'bomb-run') return true;
    const near = (a: AircraftEntity) => a.state.position.distanceToSquared(self.state.position) < 600 * 600;
    const leader = this.resolveLeader(self, world);
    if (leader) return near(leader) && this.phase !== 'rtb';
    return world.aircraft.some((a) => a !== self && a.flightId === self.flightId && isAlive(a) && near(a) && REGISTRY.get(a)?.phase !== 'rtb');
  }

  /** Leading: no leader of our own, and a flight-mate within 800 m keeping station on us. */
  private leadsFormation(self: AircraftEntity, world: WorldQuery): boolean {
    if (this.resolveLeader(self, world)) return false;
    return world.aircraft.some((a) => a !== self && a.flightId === self.flightId && isAlive(a) && REGISTRY.get(a)?.phase === 'formation' && a.state.position.distanceToSquared(self.state.position) < 800 * 800);
  }

  private formationSlot(self: AircraftEntity, world: WorldQuery, leader: AircraftEntity): number {
    if (this.opts.formationSlot != null && this.opts.leaderId === leader.id) return this.opts.formationSlot;
    // Infer: my rank among surviving flight members other than the leader.
    let slot = 1;
    for (const a of world.aircraft) {
      if (a.flightId === self.flightId && a.id !== leader.id && a.id < self.id && isAlive(a)) slot++;
    }
    return slot;
  }

  private decide(self: AircraftEntity, world: WorldQuery): void {
    const p = this.profile;
    const known = this.perception.knownEnemies(world);

    // ---- threat & defence ------------------------------------------------
    let maxThreat = 0;
    let attacker: AircraftEntity | undefined;
    for (const e of known) {
      const t = threatLevel(self, e);
      if (t > maxThreat) {
        maxThreat = t;
        attacker = e;
      }
    }
    if (this.now - this.hitAt < 1.5 && this.threatId != null) {
      const e = world.getEntity(this.threatId);
      if (e && e.kind === 'aircraft' && isAlive(e)) {
        maxThreat = 1;
        attacker = e;
      }
    }
    // Target fixation: novices sometimes ignore what's behind them while attacking.
    if (this.phase === 'engage' && this.now >= this.fixatedUntil && this.rng() < p.fixation * 0.05) this.fixatedUntil = this.now + 2.5;
    let fixated = this.now < this.fixatedUntil && this.now - this.hitAt > 1.5;
    // Experienced pilots press home a good attack unless the threat is right on them.
    if (!fixated && this.phase === 'engage' && this.targetId != null && attacker && attacker.id !== this.targetId && this.now - this.hitAt > 1.5) {
      const tgt = world.getEntity(this.targetId);
      if (tgt && tgt.kind === 'aircraft') {
        _rel.copy(tgt.state.position).sub(self.state.position);
        const onTarget = _rel.length() < 350 && angleBetween(forwardOf(self.state.orientation, _tmp), _rel) < 20 * DEG;
        const attDist = attacker.state.position.distanceTo(self.state.position);
        if (onTarget && attDist > lerpN(250, 450, 1 - p.t)) fixated = true;
      }
    }

    const steady = this.holdsFormation(self, world);
    if (steady && this.phase === 'defend') {
      this.maneuver = null;
      this.phase = 'mission';
    }
    if (maxThreat >= p.defensiveThreshold && !fixated && !steady) {
      if (this.threatSince < 0) this.threatSince = this.now;
      if (this.now - this.threatSince >= p.reactionDelay) {
        const expired = !this.maneuver || this.now >= this.maneuver.until;
        // A new manoeuvre when the last has run out, or at once on turning to defend. On the
        // way home the phase stays 'rtb', so there only an expired manoeuvre is replaced.
        if (expired || (this.phase !== 'defend' && this.phase !== 'rtb')) {
          // Aces reverse onto an attacker that has overshot.
          if (attacker && p.t > 0.6 && this.phase === 'defend' && this.overshot(self, attacker)) {
            this.maneuver = null;
            this.threatSince = -1;
            this.targetId = attacker.id;
            this.phase = this.phase === 'defend' ? 'engage' : this.phase;
            return;
          }
          const agl = self.state.heightAboveGround;
          // Count manoeuvres in a row against the same attacker: one that is still behind us
          // after a break gets something else (TACTICS_FLAGS.escalateDefence).
          const st = this.defenceStreak;
          const level = st.level(attacker?.id, this.now);
          // Not on the way home: a hurt pilot's job is to get there (or into cloud), and an
          // escalated spiral would drop him out of the bottom of a refuge cloud.
          const escalation =
            TACTICS_FLAGS.escalateDefence && this.phase !== 'rtb'
              ? { level, lastKind: st.lastKind, lastSide: st.lastSide, mode: defenceMode(), reversal: TACTICS_FLAGS.defenceReversal }
              : undefined;
          this.maneuver = chooseDefensive(self, attacker, this.traits, p, agl, this.now, this.rng, agl < LOW_AGL ? homeDirection(self, world) : undefined, TACTICS_FLAGS.meetBounce, escalation);
          st.started(attacker?.id, this.maneuver, level);
          if (this.phase !== 'rtb') this.phase = 'defend';
          this.threatId = attacker?.id ?? null;
        }
        return;
      }
    } else {
      this.threatSince = -1;
    }
    if (this.maneuver && this.now < this.maneuver.until && (this.phase === 'defend' || this.phase === 'rtb')) return;
    this.maneuver = null;
    if (this.phase === 'defend') {
      // Threat gone: counter-attack the attacker if we're a fighter, else resume.
      this.phase = 'mission';
      if (attacker && this.canEngage() && this.traits.hasFixedGuns) this.targetId = attacker.id;
    }

    if (this.phase === 'landing') return;
    if (this.phase === 'rtb') {
      // Going home because the job is done (or ordered home) is no reason not to fight
      // back: a healthy fighter with ammunition turns on a scout that is attacking it or
      // its flight, instead of being shot in the back all the way to the lines.
      if (!VOLUNTARY_RTB.has(this.rtbReason) || !this.canFightBack(self)) return;
      const leader = this.resolveLeader(self, world);
      const threat = known.find(
        (e) =>
          e.spec.role === 'fighter' &&
          e.state.position.distanceTo(self.state.position) < 1200 &&
          (isAttacking(e, self, 1000) || (leader !== null && isAttacking(e, leader, 1000))),
      );
      if (!threat) return;
      this.resumeRtb = this.rtbReason;
      this.rtbReason = '';
      this.targetId = threat.id;
      this.phase = 'engage';
      return;
    }

    // ---- engagement ------------------------------------------------------
    if (this.phase === 'extend' && this.now < this.extendUntil) return;
    const target = this.chooseTarget(self, world, known);
    if (target) {
      this.targetId = target.id;
      this.phase = 'engage';
      return;
    }
    this.targetId = null;
    if (this.phase === 'engage' || this.phase === 'extend') {
      this.phase = 'mission';
      // Fought off an attacker on the way home: carry on home.
      if (this.resumeRtb) {
        const reason = this.resumeRtb;
        this.resumeRtb = '';
        this.startRtb(reason);
      }
    }
  }

  /** Fit to turn and fight: ammunition, airframe and pilot in reasonable shape. */
  private canFightBack(self: AircraftEntity): boolean {
    if (!this.canEngage()) return false;
    if (self.damage.pilotWounded || self.damage.smoking || self.damage.onFire) return false;
    return fixedAmmoFraction(self) > 0.2 && damageSum(self) < 0.6;
  }

  private canEngage(): boolean {
    const task = this.opts.task;
    if (task === 'recon' || task === 'bomb') return false;
    if (!this.traits.hasFixedGuns) return false;
    return this.order !== 'form-up';
  }

  private overshot(self: AircraftEntity, attacker: AircraftEntity): boolean {
    _rel.copy(attacker.state.position).sub(self.state.position);
    const f = forwardOf(self.state.orientation, _tmp);
    return _rel.length() < 600 && angleBetween(f, _rel) < 70 * DEG;
  }

  private chooseTarget(self: AircraftEntity, world: WorldQuery, known: AircraftEntity[]): AircraftEntity | null {
    if (!this.canEngage()) return null;
    const task = this.opts.task;
    const leader = this.resolveLeader(self, world);
    // Ordered target.
    if (this.order === 'attack-my-target' && this.orderTargetId != null) {
      const e = world.getEntity(this.orderTargetId);
      if (e && e.kind === 'aircraft' && isAlive(e)) {
        this.perception.notice(e.id, this.now, e);
        return e;
      }
      this.order = 'engage-at-will';
    }
    if (known.length === 0) return null;
    // Balloon/ground-attack flights ignore distant scouts, but break off a low-level run to fight
    // any that close in: strafing with a scout on your tail is how balloon-busters died.
    if ((task === 'balloon-attack' || task === 'ground-attack') && this.phase !== 'engage') {
      // Committed to a run and nearly there: press it home unless someone is right on us.
      const committed = this.attackStage === 'run' && (this.phase === 'attack-balloon' || this.phase === 'attack-ground');
      const close = known.find((e) => {
        const r = e.state.position.distanceTo(self.state.position);
        if (committed) return r < 500 && isAttacking(e, self, 600);
        return (e.spec.role === 'fighter' && r < 1500) || (r < 1000 && isAttacking(e, self, 1000));
      });
      if (!close) return null;
    }

    // Engagement radius depends on role and orders.
    let radius = this.profile.spotRange;
    let anchor: Vector3 = self.state.position;
    const leaderCtl = leader ? REGISTRY.get(leader) : undefined;
    if (leader && this.order === 'default') {
      // Wingmen join in when the leader engages or enemies close on the flight.
      if (leaderCtl && leaderCtl.phase === 'engage') radius = this.profile.spotRange;
      else radius = 1800;
      anchor = leader.state.position;
    }
    let escortees: AircraftEntity[] = [];
    if (task === 'escort') {
      escortees = this.escortees(self, world);
      if (escortees.length) radius = 1800;
    }
    // Bombers' escorts stay with them (docs/ai.md "Bombers"): they go for a scout coming at
    // the bombers or at themselves, and let one that runs off, or only shadows, go.
    const guardsBombers = escortees.length > 0 && world.getFlight(escortees[0].flightId)?.task === 'bomb';

    let best: AircraftEntity | null = null;
    let bestScore = -Infinity;
    for (const e of known) {
      const r = e.state.position.distanceTo(self.state.position);
      let inScope = e.state.position.distanceTo(anchor) < radius || r < 900;
      if (escortees.length) inScope = escortees.some((m) => m.state.position.distanceTo(e.state.position) < radius) || r < 700;
      if (guardsBombers)
        inScope =
          escortees.some((m) => isAttacking(e, m, 1500) || (e.id === this.targetId && m.state.position.distanceTo(e.state.position) < 1200)) ||
          (r < 700 && isAttacking(e, self, 700));
      if (this.order === 'cover-me' && leader) inScope = isAttacking(e, leader, 1000) || (r < 500 && isAttacking(e, self, 600));
      if (!inScope) continue;
      let s = 1 / (1 + r / 800);
      if (leader && isAttacking(e, leader)) s += 0.6;
      for (const m of escortees) if (isAttacking(e, m, 900)) s += 0.7;
      if (isAttacking(e, self)) s += 0.4;
      if (damageSum(e) > 0.3 || e.damage.smoking) s += 0.25;
      if (task === 'defend' && e.spec.role !== 'fighter') s += isBomber(e) ? 0.9 : 0.5;
      // Interceptors are sent for the bombers: their escort, if it isn't attacking us or ours, can wait.
      if (task === 'defend' && e.spec.role === 'fighter' && this.escortsBombers(e, world) && !isAttacking(e, self) && !(leader && isAttacking(e, leader)) && !world.aircraft.some((m) => m !== self && m.side === self.side && m.flightId === self.flightId && isAttacking(e, m))) s -= 0.3;
      if (this.traits.style === 'energy' && e.state.position.y > self.state.position.y + 500) s -= 0.2;
      // Signatures: stragglers (nobody of his own within 800 m) and two-seaters.
      if (this.tactics.twoSeaterBias && e.spec.geometry.crew >= 2) s += this.tactics.twoSeaterBias;
      if (this.tactics.stragglerBias && !world.aircraft.some((o) => o !== e && o.side === e.side && isAlive(o) && o.state.position.distanceToSquared(e.state.position) < 800 * 800)) s += this.tactics.stragglerBias;
      // Spread targets across the flight.
      for (const a of world.aircraft) {
        if (a === self || a.side !== self.side) continue;
        const ctl = REGISTRY.get(a);
        // Strongly prefer an unengaged enemy: a whole flight piling onto the leader
        // is how a patrol leader dies in the first minute.
        if (ctl && ctl.targetId === e.id) s -= 0.35;
      }
      if (e.id === this.targetId) s *= 1.4;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  /** Is `e` flying escort to a bomber flight? */
  private escortsBombers(e: AircraftEntity, world: WorldQuery): boolean {
    const f = world.getFlight(e.flightId);
    return f?.task === 'escort' && !!f.escortFlightId && world.getFlight(f.escortFlightId)?.task === 'bomb';
  }

  private escortees(self: AircraftEntity, world: WorldQuery): AircraftEntity[] {
    const f = world.getFlight(self.flightId);
    const id = f?.escortFlightId;
    if (!id) return [];
    return world.aircraft.filter((a) => a.flightId === id && isAlive(a));
  }

  // =====================================================================
  // Steering
  // =====================================================================

  private computeSteer(self: AircraftEntity, world: WorldQuery, dt: number, steer: SteerCommand): void {
    switch (this.phase) {
      case 'defend': {
        const att = this.threatId != null ? (world.getEntity(this.threatId) as AircraftEntity | undefined) : undefined;
        if (this.maneuver) maneuverSteer(this.maneuver, self, att?.kind === 'aircraft' ? att : undefined, this.now, this.rng, steer);
        return;
      }
      case 'engage':
      case 'extend':
        if (this.steerAttack(self, world, dt, steer)) return;
        this.phase = 'mission';
        break;
      case 'rtb':
        if (this.maneuver && this.now < this.maneuver.until) {
          const att = this.threatId != null ? (world.getEntity(this.threatId) as AircraftEntity | undefined) : undefined;
          maneuverSteer(this.maneuver, self, att?.kind === 'aircraft' ? att : undefined, this.now, this.rng, steer);
          return;
        }
        this.steerRtb(self, world, steer);
        return;
      case 'landing':
        this.steerLanding(self, world, steer);
        return;
      default:
        break;
    }
    this.steerMission(self, world, steer);
  }

  private steerMission(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): void {
    const leader = this.resolveLeader(self, world);
    const maxSpd = this.traits.maxSpeed * 1.05;
    steer.maxG = Math.min(this.profile.maxG, 2.5);
    if (leader) {
      // Follow the leader, whatever he is doing (unless he's gone home without us).
      const slot = this.formationSlot(self, world, leader);
      const fs = formationSteer(self, leader, formationOffset(slot), maxSpd);
      steer.dir.copy(fs.dir);
      steer.speed = fs.speed;
      steer.maxG = fs.distance > 400 ? Math.min(this.profile.maxG, 3.5) : 3;
      this.phase = 'formation';
      // Releasing on the leader: straight and level on his heading, no sideways correction
      // into the slot. A bomb keeps the aircraft's drift through a 20-odd second fall, so
      // 10 m/s sideways at release puts it 200 m off.
      if (this.opts.task === 'bomb' && (this.stick || this.onLeader)) {
        const lv = leader.state.velocity;
        steer.dir.set(lv.x, 0, lv.z);
        if (steer.dir.lengthSq() < 1) forwardOf(leader.state.orientation, steer.dir).setY(0);
        steer.dir.normalize();
        steer.dir.y = clamp((leader.state.position.y - self.state.position.y) / 800, -0.04, 0.04);
        steer.maxG = 1.4;
      }
      // A bomber keeps his place on the route, so if he has to lead he goes on from there.
      const lc = this.opts.task === 'bomb' ? REGISTRY.get(leader) : undefined;
      if (lc && lc.wpIndex > this.wpIndex) {
        this.wpIndex = lc.wpIndex - 1;
        this.nextWaypoint();
      }
      return;
    }
    // Leader: escort station, else waypoints.
    if (this.opts.task === 'escort') {
      const es = this.escortees(self, world);
      // Job done once the charges are back over our lines and their leader is heading in to land
      // (his wingmen stay in formation on him until he's down).
      const chargesHome =
        es.length > 0 &&
        es.every((e) => world.sideOfFrontAt(e.state.position.x, e.state.position.z) === self.side) &&
        es.some((e) => {
          const ph = REGISTRY.get(e)?.phase;
          return ph === 'rtb' || ph === 'landing' || ph === 'landed';
        });
      if (chargesHome) {
        this.startRtb('escort complete');
        return;
      }
      if (es.length) {
        const lead = es.reduce((a, b) => (a.id < b.id ? a : b));
        const fs = formationSteer(self, lead, new Vector3(0, 300, 250), maxSpd);
        steer.dir.copy(fs.dir);
        steer.speed = Math.max(fs.speed, this.traits.stallSpeed * 1.6);
        this.phase = 'escort';
        return;
      }
    }
    const flight = world.getFlight(self.flightId);
    const wps = flight?.waypoints ?? [];
    if (this.missionDone || this.wpIndex >= wps.length) {
      this.missionDone = true;
      if (wps.length === 0 && !this.opts.homeAerodromeId) {
        // No route: loiter where we are (quick-combat furballs).
        if (!this.loiter) this.loiter = self.state.position.clone().add(new Vector3(1200, 0, 0));
        steer.dir.copy(orbitSteer(self, this.loiter.x, this.loiter.z, this.loiter.y, 1200));
        steer.speed = this.traits.cruiseSpeed;
        this.phase = 'patrol';
        return;
      }
      this.startRtb('mission complete');
      this.steerRtb(self, world, steer);
      return;
    }
    const wp = wps[this.wpIndex];
    if (this.wpStarted < 0) this.wpStarted = this.now;
    this.phase = 'mission';
    if (this.holdRun(self, world, steer)) return;
    const p = self.state.position;
    const dist = Math.hypot(wp.x - p.x, wp.z - p.z);
    switch (wp.action) {
      case 'patrol':
        if (dist < 1800 || this.patrolUntil > 0) {
          if (this.patrolUntil < 0) this.patrolUntil = this.now + (wp.duration ?? 240);
          if (this.now >= this.patrolUntil) return this.nextWaypoint();
          steer.dir.copy(orbitSteer(self, wp.x, wp.z, wp.altitude, 1500));
          steer.speed = this.traits.cruiseSpeed;
          this.phase = 'patrol';
          return;
        }
        break;
      case 'rendezvous':
        if (dist < 1500 || this.patrolUntil > 0) {
          if (this.patrolUntil < 0) this.patrolUntil = this.now + (wp.duration ?? 60);
          if (this.now >= this.patrolUntil) return this.nextWaypoint();
          steer.dir.copy(orbitSteer(self, wp.x, wp.z, wp.altitude, 1200));
          steer.speed = this.traits.cruiseSpeed;
          this.phase = 'patrol';
          return;
        }
        break;
      case 'attack-balloon':
      case 'attack-ground':
        if (dist < 5000) {
          if (this.attackPhaseStarted < 0) this.attackPhaseStarted = this.now;
          if (this.steerTargetAttack(self, world, wp, steer)) return;
          return this.nextWaypoint();
        }
        break;
      case 'bomb':
        // Nothing (more) to drop, or nobody left to drop it: fly over it like a 'fly' waypoint.
        if (!canBomb(self)) {
          // His stick has just gone (or his bomb aimer with it): the run is over.
          if (dist < 700 || this.bombRun?.stage === 'run') return this.nextWaypoint();
          break;
        }
        if (this.steerBombRun(self, world, wp, steer)) return;
        return this.nextWaypoint();
      case 'land': {
        const a = nearestFriendlyAerodrome(self.side, wp.x, wp.z, world.date);
        if (a && dist < 5000) {
          this.landing = planLanding(a, (x, z) => world.groundHeightAt(x, z), this.landingLane(self, world));
          this.landingStage = 'approach';
          this.phase = 'landing';
          this.steerLanding(self, world, steer);
          return;
        }
        break;
      }
      default:
        if (dist < 700) return this.nextWaypoint();
    }
    steer.dir.copy(toPointSteer(self, wp.x, wp.altitude, wp.z));
    steer.speed = this.traits.cruiseSpeed;
  }

  private nextWaypoint(): void {
    this.wpIndex++;
    // Off a bomb run: hold it a little for the formation (holdRun).
    const br = this.bombRun;
    this.runHold = br?.stage === 'run' ? { dir: br.dir.clone(), alt: br.alt, until: this.now + RUN_HOLD_S } : null;
    this.bombRun = null;
    this.patrolUntil = -1;
    this.wpStarted = -1;
    this.attackPhaseStarted = -1;
    this.attackObjId = null;
    this.attackStage = 'approach';
    this.attackPasses = 0;
  }

  /** Pursuit & gunnery against the current air target. Returns false if no target. */
  private steerAttack(self: AircraftEntity, world: WorldQuery, dt: number, steer: SteerCommand): boolean {
    const tgt = this.targetId != null ? world.getEntity(this.targetId) : undefined;
    if (!tgt || tgt.kind !== 'aircraft' || !isAlive(tgt)) {
      this.targetId = null;
      return false;
    }
    const s = self.state;
    const ts = tgt.state;
    this.updateTargetAccel(tgt, dt);
    _rel.copy(ts.position).sub(s.position);
    const r = _rel.length();
    const f = forwardOf(s.orientation, _tmp);
    const p = this.profile;
    steer.speed = Infinity;
    steer.maxG = p.maxG;
    steer.aggression = 1.2 + 0.4 * p.t;

    // Boom-and-zoom extension after a firing pass.
    if (this.phase === 'extend') {
      if (this.now < this.extendUntil) {
        // First the break away from the merge, at full g; then extend level-ish.
        if (this.now < this.breakUntil) {
          steer.dir.copy(this.breakDir).addScaledVector(f, 0.35);
          return true;
        }
        const fh = _tmp2.set(f.x, 0, f.z).normalize();
        steer.dir.copy(fh).add(new Vector3(0, 0.35, 0));
        steer.maxG = 3;
        return true;
      }
      this.phase = 'engage';
    }

    const tSpeed = ts.velocity.length();
    const closure = -_rel.dot(_tmp2.copy(ts.velocity).sub(s.velocity)) / Math.max(r, 1);
    const angleOff = angleBetween(ts.velocity, s.velocity);
    const passed = _rel.dot(f) < 0 && r < 300;

    // Too close: break off to avoid a collision. Head-on the two close at 100+ m/s, so the
    // break comes about two seconds out, not at 55 m (half a second, too late to dodge a
    // pilot who holds his line - as a human player shooting head-on does).
    if (closure > 3 && r < Math.max(55, closure * BREAK_LEAD_S)) {
      this.startExtend(2.5);
      this.startBreak(self, tgt, BREAK_S);
      steer.dir.copy(this.breakDir).addScaledVector(f, 0.35);
      return true;
    }
    // Lost him at a distance (cloud, glare): fly to where he was heading, not where he is.
    // Close in, a pilot who loses sight under the nose or behind the wing still knows where
    // a man he was just fighting is, so the ordinary pursuit (and its collision care) runs,
    // unless it is cloud that hides him: then there is nothing to follow even at 100 m. The
    // head-on break above still uses the true geometry, so this can't fly him into a ram.
    const seen = this.perception.contact(tgt.id);
    if (
      TACTICS_FLAGS.memoryPursuit && seen && !seen.visible && this.now - this.hitAt > 1.5 &&
      (seen.position.distanceTo(s.position) > 350 || cloudHides(s.position, ts.position, world))
    ) {
      const age = Math.min(this.now - seen.lastSeen, 8);
      steer.dir.copy(seen.position).addScaledVector(seen.velocity, age).sub(s.position);
      steer.maxG = Math.min(p.maxG, 3.5);
      steer.minAgl = p.groundMargin * 0.6;
      return true;
    }
    if (this.useBoomZoom(self, tgt)) {
      this.steerBoomZoom(self, tgt, world, steer, r, f, dt);
      return true;
    }
    this.bz = null;
    // Energy fighters extend after a pass instead of turning.
    if (this.traits.style === 'energy' && p.t > 0.3 && passed && s.velocity.length() > tSpeed + 5 && angleOff > 60 * DEG) {
      this.startExtend(5 + 3 * this.rng());
      return true;
    }

    if (this.steerBlindSpot(self, tgt, world, steer, r)) return true;
    if (this.steerStalk(self, tgt, world, steer, r)) return true;
    // Aces gain height before engaging a distant enemy (and approach two-seaters from below).
    if (r > 1500 && p.energyTactics > 0.5 && s.position.y < ts.position.y + 250 && this.now - this.hitAt > 5) {
      const back = _tmp2.copy(ts.velocity).setY(0);
      if (back.lengthSq() > 1) back.normalize();
      const aim = ts.position.clone().addScaledVector(back, -350).add(new Vector3(0, 350, 0)).sub(s.position);
      steer.dir.copy(aim);
      steer.maxG = 3;
      return true;
    }

    const mv = this.traits.fixedMuzzleVelocity || 800;
    if (r < 800) {
      this.aimAt(self, tgt, mv, dt, steer.dir);
      steer.aim = true;
      // Overshoot guard: lag pursuit and throttle back when closing fast at high angle-off.
      // The lag point is a fraction of the range behind the target, so the nose stays on
      // the inside of its turn (a fixed 120 m would point outside it at longer range).
      if (r < 220 && closure > 18 && angleOff > 45 * DEG) {
        const behind = ts.position.clone().addScaledVector(_tmp2.copy(ts.velocity).normalize(), -Math.min(60, 0.25 * r)).sub(s.position);
        steer.dir.copy(behind);
        steer.aim = false;
      }
      // Range hold on the six: close to ~110 m and stay there rather than overshooting.
      if (r < 450 && angleOff < 70 * DEG) steer.speed = Math.max(tSpeed + clamp((r - 110) * 0.2, -15, 40), this.traits.stallSpeed * 1.45);
      // Rear gunner caution: approach two-seaters from below.
      if (tgt.spec.geometry.crew >= 2 && r > 250 && p.t > 0.5) steer.dir.y -= 0.06;
    } else {
      // Intercept: aim at the predicted position.
      const vc = Math.max(20, closure);
      const tIntercept = clamp(r / vc, 0, 30);
      steer.dir.copy(ts.position).addScaledVector(ts.velocity, tIntercept * 0.6).sub(s.position);
    }
    // Fragile types don't dive past their limit.
    if (s.velocity.length() > this.traits.maxSafeDiveSpeed * 0.95 && steer.dir.y < 0) {
      steer.dir.normalize();
      steer.dir.y = Math.max(steer.dir.y, 0);
    }
    steer.minAgl = p.groundMargin * 0.6;
    return true;
  }

  /**
   * Stalking (DECISIONS "Stalking and ace signatures"): a patient pilot who has seen his
   * target without being seen climbs to a setup point above it and, if he uses the sun,
   * round to where the target must look into it, then attacks from there. He goes in at
   * once if he is spotted, and when his patience runs out.
   */
  private steerStalk(self: AircraftEntity, tgt: AircraftEntity, world: WorldQuery, steer: SteerCommand, r: number): boolean {
    const tp = this.tactics;
    // The setup point itself is ~600-1,600 m out along the sun line, so only a target this
    // close ends the stalk.
    if (!TACTICS_FLAGS.stalk || tp.patience <= 0 || r < 500 || this.now - this.hitAt < 5) {
      if (r < 500) this.stalk = null;
      return false;
    }
    if (!this.stalk || this.stalk.targetId !== tgt.id) this.stalk = { targetId: tgt.id, since: this.now };
    if (this.now - this.stalk.since > tp.patience || likelySpottedBy(self, tgt, world)) return false;
    const s = self.state;
    const dh = s.position.y - tgt.state.position.y;
    const sun = world.sunDirection;
    const useSun = tp.sunUse >= 0.3 && sun !== undefined && sun.y > 0.05;
    if (!useSun) {
      if (dh >= tp.heightAdv * 0.8) return false;
      attackSetupPoint(tgt, world, tp.heightAdv + 60, 0, steer.dir).sub(s.position);
    } else {
      // Work round to the sun's bearing at a distance (beyond his spotting range), then run
      // in down the sun line: inside ~5-15° of the sun he is blind to us (perception glare).
      const sa = sunAngle(tgt.state.position, s.position, world);
      if (sa < 12 * DEG) {
        if (r < 650) return false;
        // In the glare: come down the sun line at him. The line moves with the target, so
        // fly a constant-bearing course along it: his velocity plus a closing speed c
        // toward him along the line (|v_t − c·sun| = our speed), plus a correction back
        // onto the line. Steering for a point on the line lags a crossing target and drifts
        // out of the glare (the attacker ended 30°+ off the sun at 600 m).
        // Solve with the speed of a powered dive, not the current one: a stalker slower
        // than a crossing target would otherwise find no closing speed and just fly
        // alongside him, sliding off the line.
        const vt = tgt.state.velocity;
        const S = Math.max(s.velocity.length(), this.traits.maxSpeed * 0.9);
        const vs = vt.dot(sun);
        const c = vs + Math.sqrt(Math.max(0, vs * vs - vt.lengthSq() + S * S));
        const off = _tmp2.copy(s.position).sub(tgt.state.position);
        off.addScaledVector(sun, -off.dot(sun)); // offset from the line, perpendicular to it
        // Below the line, climb back only gently: the 5° glare core is 100-200 m wide at
        // these ranges, and a speed-bleeding climb loses the run.
        if (off.y < 0) off.y *= 0.25;
        steer.dir.copy(vt).addScaledVector(sun, -Math.max(c, 10)).addScaledVector(off, -0.15);
        this.stalk.since = Math.max(this.stalk.since, this.now - tp.patience + 5);
        steer.speed = Infinity;
        steer.maxG = 3;
        steer.minAgl = this.profile.groundMargin;
        return true;
      }
      const rel = _tmp2.copy(s.position).sub(tgt.state.position).setY(0);
      const onBearing = rel.lengthSq() > 1 && rel.angleTo(new Vector3(sun.x, 0, sun.z)) < 15 * DEG;
      if (onBearing && dh >= tp.heightAdv * 0.8) {
        // On his sun bearing with the height: close in level until inside the glare.
        steer.dir.copy(tgt.state.position).sub(s.position);
        steer.dir.y = tgt.state.position.y + tp.heightAdv - s.position.y;
        steer.speed = Infinity;
        steer.maxG = 3;
        steer.minAgl = this.profile.groundMargin;
        return true;
      }
      attackSetupPoint(tgt, world, tp.heightAdv + 60, 1, steer.dir, clamp(r * 0.85, 1500, 3000)).sub(s.position);
    }
    const hd = Math.hypot(steer.dir.x, steer.dir.z);
    if (steer.dir.y > hd * 0.35) steer.dir.y = hd * 0.35;
    // Climb while short of the height; with it in hand, close at speed round into the sun.
    steer.speed = dh < tp.heightAdv * 0.8 ? Math.max(this.traits.bestClimbSpeed * 1.2, this.traits.cruiseSpeed * 0.8) : Infinity;
    steer.maxG = 3;
    steer.minAgl = this.profile.groundMargin;
    return true;
  }

  /**
   * Against a bomber (docs/ai.md "Bombers"): a pilot above novice works round to where the
   * fewest of its live gunners can bear, below and behind for most types (bombing.ts
   * blindSpot, from the station arcs), 300-600 m out, before he closes in to fire. Inside
   * 250 m, or once in that cone, the ordinary pursuit takes over.
   */
  private steerBlindSpot(self: AircraftEntity, tgt: AircraftEntity, world: WorldQuery, steer: SteerCommand, r: number): boolean {
    if (!TACTICS_FLAGS.blindSpot || this.profile.t < 0.3 || r < 250 || r > 1800 || !isBomber(tgt)) return false;
    const s = self.state;
    const ts = tgt.state;
    const spot = blindSpot(tgt, s.position, _tmp2);
    const from = _tmp3.copy(s.position).sub(ts.position);
    if (from.angleTo(spot.dir) < 25 * DEG) return false;
    const standoff = clamp(r * 0.7, 300, 600);
    const p = from.copy(ts.position).addScaledVector(spot.dir, standoff).addScaledVector(ts.velocity, 2);
    // Never below the ground margin: the spot under a low bomber is the ground.
    p.y = Math.max(p.y, world.groundHeightAt(p.x, p.z) + this.profile.groundMargin + 50);
    steer.dir.copy(p).sub(s.position);
    steer.speed = Infinity;
    steer.maxG = Math.min(this.profile.maxG, 4);
    steer.minAgl = this.profile.groundMargin * 0.6;
    return true;
  }

  /** Out-turned pilots (and, later, energy types) fly boom-and-zoom rather than turn. */
  private useBoomZoom(self: AircraftEntity, tgt: AircraftEntity): boolean {
    if (this.profile.t < 0.3 || this.tactics.commitment >= 1 || tgt.spec.role !== 'fighter') return false;
    const want = (TACTICS_FLAGS.boomZoomEnergy && this.traits.style === 'energy') || (TACTICS_FLAGS.boomZoomOutTurned && outTurnedBy(self, tgt));
    if (!want) return false;
    if (!TACTICS_FLAGS.boomZoomHighOnly) return true;
    // Only with the height already in hand: keep diving and zooming while the cycle lasts,
    // but never climb for position with him close; that just hands him the shot.
    if (this.bz && this.bz.targetId === tgt.id && this.bz.stage !== 'position') return true;
    return self.state.position.y - tgt.state.position.y > this.tactics.heightAdv * 0.6;
  }

  /**
   * Boom-and-zoom (DECISIONS "Out-turned pilots fly boom-and-zoom"): climb to a setup point
   * above (and up-sun of) the target, dive through with one burst, zoom back up along the
   * pass instead of turning after him, and set up again.
   */
  private steerBoomZoom(self: AircraftEntity, tgt: AircraftEntity, world: WorldQuery, steer: SteerCommand, r: number, f: Vector3, dt: number): void {
    const s = self.state;
    const ts = tgt.state;
    const p = this.profile;
    const tp = this.tactics;
    const dh = s.position.y - ts.position.y;
    if (!this.bz || this.bz.targetId !== tgt.id) this.bz = { stage: dh > tp.heightAdv * 0.6 ? 'attack' : 'position', since: this.now, targetId: tgt.id };
    const bz = this.bz;
    const go = (stage: BoomZoomStage) => {
      bz.stage = stage;
      bz.since = this.now;
    };
    _rel.copy(ts.position).sub(s.position);
    const off = angleBetween(f, _rel);
    const vs = this.traits.stallSpeed;
    const chased = r < 900 && isAttacking(tgt, self, 900) && off > 90 * DEG;
    if (bz.stage === 'position') {
      const high = dh >= tp.heightAdv * 0.8 && r < 1800;
      const impatient = this.now - bz.since > tp.patience && dh > 60;
      const gift = off < 20 * DEG && r < 500 && dh > -50;
      // Coming at us head-on: meet him with the guns rather than climb slowly into the merge.
      const headOn = off < 35 * DEG && r < 1500 && isAttacking(tgt, self, 1500);
      if (high || impatient || gift || headOn) go('attack');
    } else if (bz.stage === 'attack') {
      const passed = _rel.dot(f) < 0 && r < 300;
      const below = dh < -40 && off > 15 * DEG;
      const outTurned = off > 60 * DEG && r < 600;
      if (passed || r < 90 || below || outTurned || this.now - bz.since > 15) go('zoom');
    } else if (this.now - bz.since > 7 || (this.now - bz.since > 2 && s.airspeed < vs * 1.5)) {
      go('position');
      // High-only: the zoom is over; attack again only if it left us above him.
      if (TACTICS_FLAGS.boomZoomHighOnly && dh > tp.heightAdv * 0.6) go('attack');
    }

    steer.minAgl = p.groundMargin * 0.6;
    if (bz.stage === 'position') {
      if (chased && s.position.y - world.groundHeightAt(s.position.x, s.position.z) > LOW_AGL + 200) {
        // He is on our tail and we can't out-turn him: dive away (the heavier machine
        // gains on him going down), then zoom once there is room.
        const away = _tmp2.copy(s.position).sub(ts.position).setY(0).normalize();
        steer.dir.copy(away).add(new Vector3(0, -0.4, 0));
        steer.speed = Infinity;
      } else {
        attackSetupPoint(tgt, world, tp.heightAdv + 60, tp.sunUse, steer.dir).sub(s.position);
        const hd = Math.hypot(steer.dir.x, steer.dir.z);
        if (steer.dir.y > hd * 0.3) steer.dir.y = hd * 0.3;
        // Keep the speed up: a slow climber is a sitting duck at the merge.
        steer.speed = Math.max(this.traits.bestClimbSpeed * 1.3, this.traits.cruiseSpeed * 0.8);
      }
      steer.maxG = Math.min(p.maxG, 3.5);
      return;
    }
    if (bz.stage === 'zoom') {
      const fh = _tmp2.set(s.velocity.x, 0, s.velocity.z);
      if (fh.lengthSq() < 1) fh.set(f.x, 0, f.z);
      fh.normalize();
      const away = new Vector3(s.position.x - ts.position.x, 0, s.position.z - ts.position.z).normalize();
      steer.dir.copy(fh).addScaledVector(away, 0.3).add(new Vector3(0, 0.9, 0));
      steer.speed = Infinity;
      steer.maxG = Math.min(p.maxG, 3.5);
      return;
    }
    // Attack: dive through on the lead, no range hold, no lag pursuit.
    const mv = this.traits.fixedMuzzleVelocity || 800;
    steer.speed = Infinity;
    steer.maxG = p.maxG;
    if (r < 800) {
      this.aimAt(self, tgt, mv, dt, steer.dir);
      steer.aim = true;
    } else {
      const closure = Math.max(20, -_rel.dot(_tmp2.copy(ts.velocity).sub(s.velocity)) / Math.max(r, 1));
      steer.dir.copy(ts.position).addScaledVector(ts.velocity, clamp(r / closure, 0, 30) * 0.6).sub(s.position);
    }
    if (s.velocity.length() > this.traits.maxSafeDiveSpeed * 0.95 && steer.dir.y < 0) {
      steer.dir.normalize();
      steer.dir.y = Math.max(steer.dir.y, 0);
    }
  }

  private startExtend(seconds: number): void {
    this.phase = 'extend';
    this.extendUntil = this.now + seconds;
  }

  /**
   * Commit to a break away from `other`: away from where it will be at closest approach,
   * or straight up the lift line (no roll needed) when it is coming right at us. A pair
   * both flying straight at each other split by id, one up and one down.
   */
  private startBreak(self: AircraftEntity, other: AircraftEntity, seconds: number): void {
    const s = self.state;
    const rel = other.state.position.clone().sub(s.position);
    const relV = other.state.velocity.clone().sub(s.velocity);
    const vv = relV.lengthSq();
    const t = vv > 1e-3 ? clamp(-rel.dot(relV) / vv, 0, 4) : 0;
    const cpa = rel.addScaledVector(relV, t);
    const up = upOf(s.orientation, new Vector3());
    const fwd = forwardOf(s.orientation, new Vector3());
    cpa.addScaledVector(fwd, -cpa.dot(fwd));
    if (cpa.length() > 4) this.breakDir.copy(cpa).normalize().negate().addScaledVector(up, 0.5).normalize();
    else this.breakDir.copy(up).multiplyScalar(splitSide(self, other));
    this.breakUntil = this.now + seconds;
  }

  private updateTargetAccel(tgt: AircraftEntity, dt: number): void {
    if (this.prevTargetId !== tgt.id) {
      this.prevTargetId = tgt.id;
      this.prevTargetVel.copy(tgt.state.velocity);
      this.targetAcc.set(0, 0, 0);
      this.leadScale = 1 - this.profile.leadError * (0.5 + this.rng());
      return;
    }
    if (dt > 0) {
      _tmp2.copy(tgt.state.velocity).sub(this.prevTargetVel).divideScalar(dt);
      // Better pilots read the target's turn; novices ignore it.
      this.targetAcc.lerp(_tmp2, 0.3);
    }
    this.prevTargetVel.copy(tgt.state.velocity);
    if (this.profile.t < 0.3) this.targetAcc.multiplyScalar(0.3);
  }

  /** Nose direction for a guns pass on `tgt`: the skill's lead and aim wander, or the human's aim. */
  private aimAt(self: AircraftEntity, tgt: AircraftEntity, mv: number, dt: number, out: Vector3): void {
    const s = self.state;
    if (this.human) {
      this.human.track(self, tgt.id, tgt.state.position, tgt.state.velocity, mv, this.now, dt, out);
      return;
    }
    leadSolution(s.position, s.velocity, tgt.state.position, tgt.state.velocity, this.targetAcc, mv, this.leadScale, this.lead);
    out.copy(this.lead.dir);
    this.applyAimNoise(self, out, dt);
  }

  /** Ornstein-Uhlenbeck aim wander, rotating dir by small angles. */
  private applyAimNoise(self: AircraftEntity, dir: Vector3, dt: number): void {
    // A wounded pilot's aim wanders more.
    const sigma = this.profile.aimNoiseRad * (1 + 1.5 * self.damage.zones.pilot);
    const theta = 0.5;
    const k = Math.sqrt(2 * theta * dt) * sigma;
    this.noise.x += -theta * this.noise.x * dt + k * gauss(this.rng);
    this.noise.y += -theta * this.noise.y * dt + k * gauss(this.rng);
    const r = rightOf(self.state.orientation, _tmp2);
    const u = upOf(self.state.orientation, new Vector3());
    const len = dir.length();
    dir.normalize().addScaledVector(r, this.noise.x).addScaledVector(u, this.noise.y).normalize().multiplyScalar(len);
  }

  /** Balloon / ground-target attack runs near a waypoint. Returns false when finished. */
  private steerTargetAttack(self: AircraftEntity, world: WorldQuery, wp: Waypoint, steer: SteerCommand): boolean {
    const balloon = wp.action === 'attack-balloon';
    if (this.attackPhaseStarted > 0 && this.now - this.attackPhaseStarted > 300) return false;
    // A few passes, then leave with ammunition for the fight home: strafers that shoot
    // themselves dry over the lines are helpless when the defending scouts arrive.
    if (this.attackPasses >= (balloon ? 4 : 3) || fixedAmmoFraction(self) < (balloon ? 0.2 : 0.45)) return false;
    // Enemy scouts coming (between runs, with at least one pass made): leave for home at
    // speed rather than zoom up for another slow pass in front of them.
    if (this.attackStage !== 'run' && this.attackPasses > 0) {
      for (const e of world.aircraft) {
        if (e.side === self.side || !isAlive(e) || e.spec.role !== 'fighter') continue;
        if (e.state.position.distanceTo(self.state.position) < 3500) return false;
      }
    }
    let obj: BalloonEntity | GroundTargetEntity | undefined;
    if (this.attackObjId != null) {
      const e = world.getEntity(this.attackObjId);
      if (e && (e.kind === 'balloon' ? !e.destroyed && !e.burning : e.kind === 'ground' && !e.destroyed)) obj = e as BalloonEntity | GroundTargetEntity;
    }
    if (!obj) {
      const list: (BalloonEntity | GroundTargetEntity)[] = balloon ? world.balloons.filter((b) => !b.destroyed && !b.burning) : world.groundTargets.filter((g) => !g.destroyed);
      let bd = 9000;
      for (const o of list) {
        if (o.side === self.side) continue;
        // Flak positions are there to defend the target, not to be the target: strafe them
        // only when nothing else is left (they are never a mission objective).
        const d = Math.hypot(o.position.x - wp.x, o.position.z - wp.z) + (o.kind === 'ground' && o.type === 'aa-gun' ? 4000 : 0);
        if (d < bd) {
          bd = d;
          obj = o;
        }
      }
      this.attackObjId = obj ? obj.id : null;
      this.attackStage = 'approach';
    }
    if (!obj) return false;
    this.phase = balloon ? 'attack-balloon' : 'attack-ground';
    this.targetId = null;
    const s = self.state;
    const tp = obj.position;
    _rel.copy(tp).sub(s.position);
    const r = _rel.length();
    const horiz = Math.hypot(_rel.x, _rel.z);
    const gy = world.groundHeightAt(tp.x, tp.z);
    const setupAlt = balloon ? tp.y + 350 : gy + 250;
    const diveStart = balloon ? 1500 : 1300;
    steer.speed = Infinity;
    // Never pull harder than the wing can give at this speed (80% of the accelerated-stall
    // load, (V/Vs)^2): a strafer that stalls in the turn-in is a sitting duck.
    const gAvail = 0.8 * (s.airspeed / Math.max(1, this.traits.stallSpeed)) ** 2;
    const gCap = clamp(gAvail, 1.3, 4.5);
    steer.maxG = Math.min(3.5, gCap);
    if (this.attackStage === 'pullout') {
      if (this.now < this.attackStageUntil) {
        if (balloon) {
          // Break sideways and up past the envelope (turning back into it is what kills).
          const side = this.pulloutSide;
          // A level-ish break keeps the speed: a steep zoom at 4 g stalls and leaves the
          // aircraft hanging helpless over the balloon's guns.
          const perp = _tmp2.set(-_rel.z * side, 0, _rel.x * side).normalize();
          steer.dir.copy(perp).add(new Vector3(0, 0.15, 0));
          steer.maxG = Math.min(3.8, gCap);
          steer.minSpeed = this.traits.stallSpeed * 1.4;
        } else {
          // Climbing turn away, but not so steep that the aircraft hangs stalled over the guns.
          const side = this.pulloutSide;
          const away = _tmp2.set(-_rel.x, 0, -_rel.z).normalize();
          const perp = new Vector3(-_rel.z * side, 0, _rel.x * side).normalize();
          steer.dir.copy(away).add(perp).normalize().add(new Vector3(0, 0.25, 0));
          steer.maxG = Math.min(3.5, gCap);
          // Keep fighting speed between passes: the defending scouts arrive mid-attack.
          steer.minSpeed = this.traits.stallSpeed * 1.6;
        }
        steer.lowLevel = true;
        return true;
      }
      this.attackStage = 'approach';
    }
    if (this.attackStage === 'approach') {
      // Re-position for the next run without bleeding off speed: a low, slow strafer is the
      // easiest kill there is. Climb only as steeply as the airspeed margin allows.
      steer.minSpeed = this.traits.stallSpeed * (balloon ? 1.5 : 1.7);
      // Low-level terrain rules, as in the run: the normal ground margin (90-160 m) would force
      // a steep climb out of every pull-out and stall the aircraft.
      steer.lowLevel = true;
      steer.minAgl = 50;
      const margin = clamp((s.airspeed - this.traits.stallSpeed * (balloon ? 1.4 : 1.6)) / (this.traits.stallSpeed * 0.6), 0, 1);
      const maxClimb = 0.02 + 0.16 * margin;
      if (horiz < diveStart * 0.8) {
        // Too close to start a run: open the distance.
        const away = _tmp2.set(-_rel.x, 0, -_rel.z).normalize();
        steer.dir.copy(away);
        steer.dir.y = clamp((setupAlt - s.position.y) / 400, -0.3, maxClimb);
        return true;
      }
      steer.dir.copy(toPointSteer(self, tp.x, setupAlt, tp.z));
      // Reverse back onto the target with a banked turn, not a loop: asked to fly straight
      // behind itself, the autopilot pulls through the vertical and stalls at the top.
      limitTurnDemand(self, steer.dir, 40 * DEG);
      const h = Math.hypot(steer.dir.x, steer.dir.z);
      if (h > 1e-6 && steer.dir.y > maxClimb * h) steer.dir.y = maxClimb * h;
      const facing = angleBetween(forwardOf(s.orientation, _tmp), _tmp2.set(_rel.x, 0, _rel.z));
      if (horiz < diveStart && facing < 25 * DEG) this.attackStage = 'run';
      return true;
    }
    // Attack run: dive on the target, guns solution for a static target.
    if (this.human && this.attackObjId != null) this.human.track(self, this.attackObjId, tp, ZERO, this.traits.fixedMuzzleVelocity || 800, this.now, this.dt, steer.dir);
    else {
      leadSolution(s.position, s.velocity, tp, ZERO, null, this.traits.fixedMuzzleVelocity || 800, 1, this.lead);
      steer.dir.copy(this.lead.dir);
    }
    steer.aim = r < 700;
    steer.lowLevel = true;
    steer.minAgl = 30;
    const agl = s.position.y - world.groundHeightAt(s.position.x, s.position.z);
    // Break off with room to turn: at 60 m/s and 4 g the turn radius is ~90 m and a sideways
    // break clears the envelope within ~60 m, so a balloon run ends at ~160 m.
    if (r < (balloon ? 160 : 140) || agl < 45 || _rel.dot(forwardOf(s.orientation, _tmp)) < 0) {
      this.attackStage = 'pullout';
      this.attackStageUntil = this.now + (balloon ? 5 : 5);
      this.attackPasses++;
      // Pull out toward whichever side the nose already points, so the turn starts at once.
      const rgt = rightOf(s.orientation, _tmp);
      this.pulloutSide = rgt.x * _rel.x + rgt.z * _rel.z > 0 ? -1 : 1;
    }
    return true;
  }

  /**
   * The bomb run at a 'bomb' waypoint, for a formation's leader or a bomber alone (docs/ai.md
   * "Bombers"). He approaches at the waypoint's height and picks the target whose stick
   * puts the most of his formation's tracks over a target. From RUN_START_M out he flies
   * straight and level, steering only small heading corrections to lay the predicted impact
   * (`predictBombImpact`) onto it, and starts his stick when the impact reaches it (so the
   * stick straddles it). Too far off to one side, he goes round for another run; on the last
   * he releases anyway. Returns false when there is nothing left to bomb.
   */
  private steerBombRun(self: AircraftEntity, world: WorldQuery, wp: Waypoint, steer: SteerCommand): boolean {
    let targets = world.groundTargets.filter((g) => !g.destroyed && g.side !== self.side && Math.hypot(g.position.x - wp.x, g.position.z - wp.z) < TARGET_AREA_M);
    // Flak is there to defend the target, not to be it (as for strafers).
    const real = targets.filter((g) => g.type !== 'aa-gun');
    if (real.length) targets = real;
    if (!targets.length) return false;
    const s = self.state;
    const hv = _tmp3.set(s.velocity.x, 0, s.velocity.z);
    if (hv.lengthSq() < 1) forwardOf(s.orientation, hv).setY(0);
    hv.normalize();
    if (!this.bombRun) this.bombRun = { stage: 'approach', targetId: null, runs: 0, dir: hv.clone(), alt: wp.altitude };
    const br = this.bombRun;
    let aim = br.targetId != null ? targets.find((t) => t.id === br.targetId) : undefined;
    const alt = wp.altitude;
    steer.speed = this.traits.cruiseSpeed;
    steer.maxG = 2;
    if (br.stage === 'reverse') {
      // Round for another run: out beyond the run's start, back along the last run (or the
      // way he came, if he never had one), in banked turns. The approach then turns him in.
      const px = wp.x - br.dir.x * REVERSE_OUT_M;
      const pz = wp.z - br.dir.z * REVERSE_OUT_M;
      steer.dir.copy(toPointSteer(self, px, alt, pz));
      limitTurnDemand(self, steer.dir, 40 * DEG);
      if (Math.hypot(px - s.position.x, pz - s.position.z) < 1200) br.stage = 'approach';
      return true;
    }
    if (br.stage === 'approach' || !aim) {
      const to = _tmp2.set(wp.x - s.position.x, 0, wp.z - s.position.z);
      if (to.lengthSq() < 1) to.copy(hv);
      to.normalize();
      aim = chooseAimTarget(targets, this.formationLateral(self, world, to), s.position, to, this.bombCharge(self)) ?? targets[0];
      br.targetId = aim.id;
      const d = Math.hypot(aim.position.x - s.position.x, aim.position.z - s.position.z);
      const facing = Math.acos(clamp(hv.dot(to), -1, 1));
      if (d > RUN_START_M || facing > RUN_FACING) {
        // Too close to turn in and still settle on the run: go out and come round.
        if (d < RUN_MIN_TURN_IN_M && facing > RUN_FACING) {
          br.stage = 'reverse';
          br.dir.copy(to);
          return true;
        }
        steer.dir.copy(toPointSteer(self, aim.position.x, alt, aim.position.z));
        return true;
      }
      br.stage = 'run';
      br.dir.copy(to);
    }
    this.phase = 'bomb-run';
    const pred = predictBombImpact(self, world.env);
    if (!pred) return false;
    const ex = aim.position.x - pred.point.x;
    const ez = aim.position.z - pred.point.z;
    const along = ex * hv.x + ez * hv.z;
    const cross = -ex * hv.z + ez * hv.x;
    // Straight and level: small heading corrections only (about 11° at most), gentle g.
    const corr = clamp(cross / Math.max(along, 400), -0.2, 0.2);
    steer.dir.set(hv.x - hv.z * corr, 0, hv.z + hv.x * corr).normalize();
    steer.dir.y = clamp((alt - s.position.y) / 800, -0.04, 0.04);
    steer.maxG = 1.4;
    if (!this.stick) {
      const gs = Math.hypot(s.velocity.x, s.velocity.z);
      const half = ((bombsAboard(self) - 1) / 2) * this.stickInterval() * gs;
      if (along <= half && along > -60 && (Math.abs(cross) < RELEASE_CROSS_M || br.runs >= MAX_RUNS - 1)) {
        this.stick = { left: bombsAboard(self), next: this.now };
      } else if (along < -60) {
        br.runs++;
        br.stage = 'reverse';
        br.dir.copy(hv);
      }
    }
    return true;
  }

  /**
   * After his own stick, the leader holds the run's heading and height while the bombers
   * releasing on him still have bombs to drop (at most RUN_HOLD_S): turning off at once would
   * swing their sticks across the target.
   */
  private holdRun(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): boolean {
    const h = this.runHold;
    if (!h || this.now >= h.until) return false;
    // His own stick still going (the targets gone under it), or bombers releasing on him.
    const following = !!this.stick || world.aircraft.some(
      (a) => a !== self && a.flightId === self.flightId && isAlive(a) && canBomb(a) && REGISTRY.get(a)?.phase === 'formation' && a.state.position.distanceToSquared(self.state.position) < 600 * 600,
    );
    if (!following) {
      this.runHold = null;
      return false;
    }
    steer.dir.copy(h.dir);
    steer.dir.y = clamp((h.alt - self.state.position.y) / 800, -0.04, 0.04);
    steer.speed = this.traits.cruiseSpeed;
    steer.maxG = 1.4;
    return true;
  }

  /** Each formation member's offset (m) to our right across `dir`, ours (0) first: bombers with bombs, following us, within 400 m. */
  private formationLateral(self: AircraftEntity, world: WorldQuery, dir: Vector3): number[] {
    const out = [0];
    for (const a of world.aircraft) {
      if (a === self || a.flightId !== self.flightId || !isAlive(a) || !canBomb(a)) continue;
      const rel = _tmp.copy(a.state.position).sub(self.state.position);
      if (rel.lengthSq() > 400 * 400) continue;
      out.push(-rel.x * dir.z + rel.z * dir.x);
    }
    return out;
  }

  /** The stick's real interval: STICK_INTERVAL_S rounded up to whole AI ticks. */
  private stickInterval(): number {
    const dt = this.dt > 0 ? this.dt : 1 / 30;
    return Math.max(1, Math.ceil((STICK_INTERVAL_S - 1e-3) / dt)) * dt;
  }

  /** The charge (kg) of the next bomb, for aiming. */
  private bombCharge(self: AircraftEntity): number {
    const st = self.spec.bombs ?? [];
    let best = 0;
    for (let i = 0; i < st.length; i++) if ((self.bombs?.[i] ?? 0) > 0) best = Math.max(best, st[i].explosiveKg);
    return best || 10;
  }

  /**
   * Bomb release (the sim's held input: one bomb per false-to-true change). A leader's stick
   * is started by his bomb run. A bomber in formation releases on his leader's first bomb, as
   * crews did: he starts his stick when his own predicted impact comes abreast of where the
   * leader's first bomb falls (at most 4 s later), so the formation's bombs fall abreast
   * rather than short or long.
   */
  private releaseBombs(self: AircraftEntity, world: WorldQuery): void {
    const c = self.controls;
    const was = !!c.releaseBomb;
    c.releaseBomb = false;
    if (this.opts.task !== 'bomb' || !self.bombs) return;
    // The player at the bombsight releases for himself (StationInputs.releaseBomb): the AI
    // flying his aircraft meanwhile only flies him the run.
    const si = self.stationInputs;
    const playerAims = !!si && !!crewStations(self.spec).find((st) => st.id === si.station)?.bombAimer;
    if (!canBomb(self) || playerAims) {
      this.stick = null;
      this.onLeader = null;
      return;
    }
    const leader = this.phase === 'formation' ? this.resolveLeader(self, world) : null;
    if (leader) {
      const d = getBombStats(leader).dropped;
      const seen = this.leaderDrops;
      if (!seen || seen.id !== leader.id) this.leaderDrops = { id: leader.id, dropped: d };
      else if (d > seen.dropped) {
        seen.dropped = d;
        if (!this.stick && !this.onLeader && leader.state.position.distanceToSquared(self.state.position) < 400 * 400) {
          // His first bomb falls about where his next would now (one AI tick later, ~1.5 m on).
          const p = predictBombImpact(leader, world.env)?.point ?? leader.state.position;
          const dir = new Vector3(leader.state.velocity.x, 0, leader.state.velocity.z);
          if (dir.lengthSq() < 1) forwardOf(leader.state.orientation, dir).setY(0);
          dir.normalize();
          this.onLeader = { x: p.x, z: p.z, dir, until: this.now + 4 };
        }
      }
    }
    // Let go when our own bombs would fall abreast of his: our speed and place in the
    // formation change how far ours are thrown, so time it on our own sight.
    const ol = this.onLeader;
    if (ol && !this.stick) {
      const mine = predictBombImpact(self, world.env)?.point;
      const along = mine ? (ol.x - mine.x) * ol.dir.x + (ol.z - mine.z) * ol.dir.z : 0;
      if (along <= 0 || this.now >= ol.until) {
        this.stick = { left: bombsAboard(self), next: this.now };
        this.onLeader = null;
      }
    }
    const st = this.stick;
    if (!st) return;
    if (this.now >= st.next && !was) {
      c.releaseBomb = true;
      st.left--;
      st.next = this.now + this.stickInterval() - 1e-3;
    }
    if (st.left <= 0) this.stick = null;
  }

  private steerRtb(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): void {
    this.phase = 'rtb';
    const s = self.state;
    const home = (this.opts.homeAerodromeId ? getAerodrome(this.opts.homeAerodromeId) : undefined) ?? nearestFriendlyAerodrome(self.side, s.position.x, s.position.z, world.date);
    const gy = world.groundHeightAt(s.position.x, s.position.z);
    const threatened = this.now - this.hitAt < 10;
    if (self.damage.engineDead) {
      // Glide for friendly lines at best glide speed; force-land when low.
      const dir = home ? toPointSteer(self, home.x, gy, home.z) : homeDirection(self, world);
      dir.y = -0.13;
      steer.dir.copy(dir);
      steer.speed = this.traits.stallSpeed * 1.5;
      steer.minSpeed = this.traits.stallSpeed * 1.3;
      steer.lowLevel = true;
      steer.minAgl = 15;
      if (s.position.y - gy < 20) steer.dir.y = -0.02;
      return;
    }
    if (this.steerRefuge(self, world, steer)) return;
    if (home) {
      const d = Math.hypot(home.x - s.position.x, home.z - s.position.z);
      if (d < 4500 && !threatened) {
        this.landing = planLanding(home, (x, z) => world.groundHeightAt(x, z), this.landingLane(self, world));
        this.landingStage = 'approach';
        this.phase = 'landing';
        this.steerLanding(self, world, steer);
        return;
      }
      const cruiseAlt = Math.max(gy + 600, Math.min(s.position.y, gy + 1500));
      steer.dir.copy(toPointSteer(self, home.x, threatened ? s.position.y - 300 : cruiseAlt, home.z));
    } else {
      steer.dir.copy(homeDirection(self, world));
    }
    steer.speed = threatened || world.sideOfFrontAt(s.position.x, s.position.z) !== self.side ? Infinity : this.traits.cruiseSpeed;
    steer.maxG = 3;
  }

  /**
   * Cloud refuge (DECISIONS "Stalking and ace signatures"): a pilot heading home hurt, with
   * an enemy close, makes for a nearby cloud and circles its core for 25-40 s before carrying
   * on, so a pursuer loses sight of him and gives up (DECISIONS "Cloud blinds at close range").
   * Only clouds the renderer draws count (world.nearestCloud).
   */
  private steerRefuge(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): boolean {
    if (!TACTICS_FLAGS.cloudEscape || !world.nearestCloud || VOLUNTARY_RTB.has(this.rtbReason)) return false;
    const s = self.state;
    if (!this.refuge && this.now >= this.refugeCheck) {
      this.refugeCheck = this.now + 2;
      const pursuer = world.aircraft.some((e) => e.side !== self.side && isAlive(e) && e.spec.role === 'fighter' && e.state.position.distanceToSquared(s.position) < 1800 * 1800);
      if (pursuer) {
        const c = world.nearestCloud(s.position, 3000);
        // Don't climb into it slowly with a scout on us: only clouds at or below our height, or a short climb.
        if (c && c.position.y < s.position.y + 250) this.refuge = { pos: c.position.clone(), radius: c.radius, until: Infinity, turn: 0 };
      }
    }
    const rf = this.refuge;
    if (!rf) return false;
    const inside = (world.cloudDensityAt?.(s.position.x, s.position.y, s.position.z) ?? 0) > 0.3;
    // Long enough for a pursuer to lose him and give up (memory is 3-12 s): 25-40 s inside.
    if (inside && rf.until === Infinity) rf.until = this.now + REFUGE_MIN_S + 15 * this.rng();
    if (this.now > rf.until || (rf.until === Infinity && s.position.distanceTo(rf.pos) > 5000)) {
      this.refuge = null;
      this.refugeCheck = this.now + 30;
      return false;
    }
    // Refresh the drifting cloud's centre, then fly into it (and wander inside it).
    const c = world.nearestCloud(rf.pos, 600);
    if (c) {
      rf.pos.copy(c.position);
      rf.radius = c.radius;
    }
    // Into its flank at our own height (a climb for its core would hand him the shot).
    steer.dir.copy(rf.pos).sub(s.position);
    steer.dir.y = Math.min(steer.dir.y, 40);
    if (rf.until !== Infinity) {
      // Circle the core at his own height instead of flying out of the far side: a
      // hideable cumulus is only ~350 m across its core, 8 s at a wounded D.V's speed.
      const orbitR = Math.min(REFUGE_ORBIT_MAX_M, rf.radius * 0.45);
      const out = _tmp2.copy(s.position).sub(rf.pos).setY(0);
      const d = out.length();
      if (d > 1) out.divideScalar(d);
      else out.set(1, 0, 0);
      // Keep turning the way he entered (the side his velocity already carries him round).
      if (!rf.turn) rf.turn = _up.dot(_tmp3.copy(out).cross(s.velocity)) >= 0 ? 1 : -1;
      steer.dir.copy(out).cross(_up).multiplyScalar(-rf.turn).addScaledVector(out, clamp((orbitR - d) / orbitR, -1.5, 1));
      steer.dir.y = 0;
    }
    steer.speed = Infinity;
    steer.maxG = 3;
    steer.minAgl = this.profile.groundMargin;
    return true;
  }

  /** Landing lane by formation slot: grass fields are wide, so a flight lands abreast (40 m apart). */
  private landingLane(self: AircraftEntity, world: WorldQuery): number {
    // Rank within the flight by id (independent of who currently leads: a leader that is
    // already landing no longer "leads", but still occupies lane 0).
    let slot = this.opts.formationSlot ?? 0;
    if (!slot) for (const a of world.aircraft) if (a.flightId === self.flightId && a.id < self.id) slot++;
    if (!slot) return 0;
    return (slot % 2 === 1 ? 1 : -1) * 40 * Math.ceil(slot / 2);
  }

  private steerLanding(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): void {
    const plan = this.landing;
    if (!plan) {
      this.phase = 'rtb';
      return;
    }
    this.phase = 'landing';
    const s = self.state;
    const vs = this.traits.stallSpeed;
    steer.lowLevel = true;
    steer.landing = true;
    steer.maxG = 2;
    const along = _tmp.copy(s.position).sub(plan.threshold).dot(plan.dir);
    const gy = world.groundHeightAt(s.position.x, s.position.z);
    const agl = s.position.y - gy;
    if (s.onGround) {
      this.landingStage = 'rollout';
      steer.dir.copy(plan.dir);
      steer.speed = 0;
      if (s.velocity.length() < 5) {
        this.landingStage = 'stopped';
        this.phase = 'landed';
      }
      return;
    }
    const ap = plan.approachPoint;
    // Horizontal alignment of our track with the runway direction.
    const hv = Math.hypot(s.velocity.x, s.velocity.z) || 1;
    const align = (s.velocity.x * plan.dir.x + s.velocity.z * plan.dir.z) / hv;
    if (this.landingStage === 'approach') {
      // Arriving from the far side of the field (or the gate's side, misaligned): fly a
      // base point well outside the approach gate first, so the turn onto final is made
      // with height and room instead of a low 180 at the gate.
      const alongGate = (s.position.x - ap.x) * plan.dir.x + (s.position.z - ap.z) * plan.dir.z;
      if (alongGate > -600 && align < 0.5) this.landingStage = 'pattern';
    }
    if (this.landingStage === 'pattern') {
      const side = 1; // right-hand pattern
      const bx = ap.x - plan.dir.x * 1600 + plan.dir.z * 900 * side;
      const bz = ap.z - plan.dir.z * 1600 - plan.dir.x * 900 * side;
      steer.dir.copy(toPointSteer(self, bx, ap.y + 60, bz));
      steer.speed = vs * 1.8;
      steer.minAgl = 150;
      if (Math.hypot(bx - s.position.x, bz - s.position.z) < 500) this.landingStage = 'approach';
      return;
    }
    if (this.landingStage === 'approach') {
      steer.dir.copy(toPointSteer(self, ap.x, ap.y, ap.z));
      steer.speed = vs * 1.7;
      steer.minAgl = 120;
      const d = Math.hypot(ap.x - s.position.x, ap.z - s.position.z);
      if (d < 500 && align > 0.75) this.landingStage = 'final';
      else if (d < 350) this.landingStage = 'pattern'; // reached the gate misaligned: go round
      return;
    }
    if (this.landingStage === 'final') {
      const ahead = along + 300;
      const aim = plan.threshold.clone().addScaledVector(plan.dir, ahead);
      aim.y = plan.threshold.y + Math.max(0, -ahead) * Math.tan(5 * DEG) + 1;
      steer.dir.copy(aim.sub(s.position));
      steer.speed = agl > 60 ? vs * 1.35 : vs * 1.25;
      steer.minSpeed = vs * 1.2;
      steer.minAgl = 0;
      // Go around if badly misaligned or overshooting the field.
      const lateral = Math.abs(_tmp.copy(s.position).sub(plan.threshold).cross(plan.dir).y);
      if (along > plan.aerodrome.runwayLength * 0.9 || lateral > 250) {
        this.landingStage = 'approach';
        return;
      }
      if (agl < 10) this.landingStage = 'flare';
      return;
    }
    // Flare: power off (the pilot blips/cuts the engine), hold a gentle sink and let the
    // speed bleed away onto the grass. Holding power here floats a light scout for miles.
    // Heavier types arrive fast: hold them level just off the grass until the speed has
    // decayed, or they touch down fast, bounce and drop a wing.
    steer.dir.copy(plan.dir);
    const fast = s.airspeed > vs * 1.2;
    steer.dir.y = fast ? clamp((2.5 - agl) * 0.01, -0.03, 0.01) : clamp(-0.02 - agl * 0.006, -0.06, -0.02);
    steer.speed = 0;
    steer.minSpeed = 0;
    steer.minAgl = 0;
  }

  // =====================================================================
  // Safety: collision avoidance
  // =====================================================================

  private avoidCollisions(self: AircraftEntity, world: WorldQuery, steer: SteerCommand): void {
    const s = self.state;
    let wsum = 0;
    const avoid = _tmp.set(0, 0, 0);
    for (const o of world.aircraft) {
      // Falling wrecks still collide in the sim: an attacker following its victim down
      // flies into the tumbling wreck unless it dodges those too.
      if (o === self || o.state.onGround || getSimInternal(o).impacted) continue;
      const rel = _tmp2.copy(o.state.position).sub(s.position);
      const r = rel.length();
      // Head-on closures run at 100+ m/s: look ~4 s ahead.
      if (r > 450) continue;
      const relV = o.state.velocity.clone().sub(s.velocity);
      const vv = relV.lengthSq();
      const tcpa = vv > 1e-3 ? clamp(-rel.dot(relV) / vv, 0, 4) : 0;
      const cpa = rel.clone().addScaledVector(relV, tcpa);
      const dcpa = cpa.length();
      // Wider berth for wrecks, for the human player (who won't dodge for us) and for a
      // flight-mate chasing the same target: two pursuit curves converge on one tail.
      const sameTarget = o.side === self.side && this.targetId != null && REGISTRY.get(o)?.targetId === this.targetId;
      const radius = !isAlive(o) ? 40 : o.controller === 'player' || sameTarget ? 45 : 32;
      if (dcpa >= radius) continue;
      const w = (1 - dcpa / radius) * (1 - tcpa / 4.2);
      const lift = upOf(s.orientation, _collisionLift);
      // Dead ahead: retain the coordinated up/down split (splitSide).
      if (dcpa < 1) cpa.copy(lift).multiplyScalar(-splitSide(self, o));
      // During a committed extension, a late escape opposite the current lift needs
      // a >90-degree roll before it can separate us. Use the available lift then;
      // retain ordinary steering during engagement/defence and longer-range conflicts.
      // Applying this to engagement too made avoidance worse for non-dodging humans.
      else if (this.phase === 'extend' && tcpa > 0 && tcpa < BREAK_LEAD_S && cpa.dot(lift) > 0) cpa.copy(lift).negate();
      avoid.addScaledVector(cpa.normalize(), -w);
      wsum += w;
    }
    // Balloon envelopes (static): look further ahead, they are big and don't dodge.
    for (const b of world.balloons) {
      if (b.destroyed) continue;
      const rel = _tmp2.copy(b.position).sub(s.position);
      const r = rel.length();
      if (r > 300) continue;
      const vv = s.velocity.lengthSq();
      const tcpa = vv > 1e-3 ? clamp(rel.dot(s.velocity) / vv, 0, 4) : 0;
      const cpa = rel.clone().addScaledVector(s.velocity, -tcpa);
      const dcpa = cpa.length();
      const radius = 45;
      if (dcpa >= radius) continue;
      const w = 1.5 * (1 - dcpa / radius) * (1 - tcpa / 4.2);
      if (dcpa < 1) cpa.copy(upOf(s.orientation, new Vector3())).negate();
      avoid.addScaledVector(cpa.normalize(), -w);
      wsum += w;
    }
    if (wsum > 0.05) {
      steer.dir.normalize().addScaledVector(avoid.normalize(), clamp(wsum * 3, 0, 3)).normalize();
      steer.aim = false;
      // A real conflict overrides the manoeuvre's g cap (formation, extension: 3 g).
      if (wsum > 0.25) steer.maxG = undefined;
    }
  }

  // =====================================================================
  // Weapons
  // =====================================================================

  private weapons(self: AircraftEntity, world: WorldQuery, dt: number): void {
    const c = self.controls;
    c.fireGuns = false;
    c.clearJam = false;
    const fixedMounts = self.spec.guns.map((g, i) => ({ g, i })).filter((m) => m.g.mount !== 'flexible');
    if (!fixedMounts.length) return;
    // Hammer at jammed guns.
    const jammed = self.guns.some((gs) => gs.jammed && self.spec.guns[gs.mountIndex]?.mount !== 'flexible');
    if (jammed && this.now >= this.nextJamPress) {
      c.clearJam = true;
      this.nextJamPress = this.now + 1 / this.profile.jamClearRate;
    }
    const usable = self.guns.some((gs) => self.spec.guns[gs.mountIndex]?.mount !== 'flexible' && !gs.jammed && (gs.roundsLeft > 0 || gs.sparesLeft > 0));
    if (!usable) return;
    const s = self.state;
    const f = forwardOf(s.orientation, new Vector3());
    const mv = this.traits.fixedMuzzleVelocity || 800;
    const p = this.profile;

    let want = false;
    // Air target (current, or opportunistic snap shot at anything in the cone).
    const candidates: AircraftEntity[] = [];
    const cur = this.targetId != null ? world.getEntity(this.targetId) : undefined;
    if (cur && cur.kind === 'aircraft' && isAlive(cur)) candidates.push(cur);
    for (const id of this.perception.contacts.keys()) {
      const e = world.getEntity(id);
      if (e && e.kind === 'aircraft' && e !== cur && isAlive(e)) candidates.push(e);
    }
    for (const e of candidates) {
      const r = e.state.position.distanceTo(s.position);
      if (r > 600) continue;
      // No shooting at a remembered target that cloud hides (glare alone doesn't stop a
      // burst at a man he was just fighting: D-074 "Not kept").
      if (!this.perception.contact(e.id)?.visible && cloudHides(s.position, e.state.position, world)) continue;
      leadSolution(s.position, s.velocity, e.state.position, e.state.velocity, e === cur ? this.targetAcc : null, mv, 1, this.trueLead);
      const trueErr = angleBetween(f, this.trueLead.dir);
      const size = angularRadius(Math.max(3, e.spec.geometry.span * 0.4), r);
      if (e === cur && trueErr < size + 0.5 * DEG && r < 400) this.stats.gunsSolutionTime += dt;
      if (this.human) {
        // A human shoots at the man he is tracking, where he believes the lead is.
        if (e === cur && this.human.wantsFire(this.human.believedError(f, e.id, this.now), size, r, this.now)) {
          want = true;
          break;
        }
        continue;
      }
      // Perceived error: the pilot's own (imperfect) solution.
      leadSolution(s.position, s.velocity, e.state.position, e.state.velocity, e === cur ? this.targetAcc : null, mv, this.leadScale, this.lead);
      const err = angleBetween(f, this.lead.dir) + Math.abs(gauss(this.rng)) * p.aimNoiseRad * 0.5;
      const range = (e === cur ? p.fireRange : p.fireRange * 0.7) * this.tactics.fireRangeScale;
      if ((r < range && err < size + p.fireConeRad) || (r < range * 1.6 && err < size + p.fireConeRad * 0.3)) {
        want = true;
        break;
      }
      // Burst in progress: keep firing while roughly on target.
      if (this.now < this.burstUntil && r < range * 1.3 && err < size + p.fireConeRad * 2.5) {
        want = true;
        break;
      }
    }
    // Ground/balloon run.
    if (!want && (this.phase === 'attack-balloon' || this.phase === 'attack-ground') && this.attackStage === 'run' && this.attackObjId != null) {
      const o = world.getEntity(this.attackObjId);
      if (o && o.kind !== 'aircraft') {
        const r = o.position.distanceTo(s.position);
        const size = angularRadius(o.kind === 'balloon' ? 9 : 4, r);
        const range = o.kind === 'balloon' ? 480 : 450;
        if (this.human) want = this.human.wantsFire(this.human.believedError(f, o.id, this.now), size, r, this.now, range);
        else {
          leadSolution(s.position, s.velocity, o.position, ZERO, null, mv, 1, this.lead);
          if (r < range && angleBetween(f, this.lead.dir) < size + p.fireConeRad) want = true;
        }
      }
    }
    if (want && !this.lineOfFireClear(self, world, f)) want = false;

    if (want && this.human) {
      this.human.pull(this.now);
      c.fireGuns = true;
    } else if (want) {
      if (this.now >= this.burstUntil && this.now >= this.burstNext) {
        this.burstUntil = this.now + p.burstLength * this.tactics.burstScale * (0.7 + 0.6 * this.rng());
        this.burstNext = this.burstUntil + p.burstPause * (0.7 + 0.6 * this.rng());
        this.leadScale = 1 - p.leadError * (0.5 + this.rng());
      }
      if (this.now < this.burstUntil) c.fireGuns = true;
    }
    if (c.fireGuns) this.stats.firingTime += dt;
  }

  private lineOfFireClear(self: AircraftEntity, world: WorldQuery, f: Vector3): boolean {
    for (const a of world.aircraft) {
      if (a === self || a.side !== self.side || !isAlive(a)) continue;
      const rel = _tmp2.copy(a.state.position).sub(self.state.position);
      const r = rel.length();
      if (r > 700) continue;
      if (angleBetween(f, rel) < angularRadius(12, r) + 2 * DEG) return false;
    }
    return true;
  }

  private gunner(self: AircraftEntity, world: WorldQuery): void {
    const hook = this.opts.setGunnerTarget;
    if (!hook || !this.traits.hasFlexibleGun) return;
    const gunners = gunnersOf(self);
    if (gunners.size >= 2) {
      this.stationGunners(self, world, gunners, hook);
      return;
    }
    let pick: number | null = null;
    if (self.damage.zones.gunner < 1) {
      // Rear gunners watch the tail; a pusher's nose gunner watches ahead.
      const back = forwardOf(self.state.orientation, new Vector3());
      if (!gunnerFacesForward(self.spec)) back.negate();
      let best = Infinity;
      for (const e of world.aircraft) {
        if (e.side === self.side || !isAlive(e)) continue;
        const rel = _tmp2.copy(e.state.position).sub(self.state.position);
        const r = rel.length();
        if (r > 650) continue;
        if (angleBetween(back, rel) > 115 * DEG) continue;
        const score = r * (isAttacking(e, self) ? 0.5 : 1);
        if (score < best) {
          best = score;
          pick = e.id;
        }
      }
    }
    if (pick !== this.gunnerTarget) {
      this.gunnerTarget = pick;
      hook(self, pick);
    }
  }

  /**
   * Several gunners aboard (the Gotha, the O/400): each live man takes the enemy his own
   * stations bear on, nearest first, one attacking us counting as half the range and one
   * attacking a formation-mate within 400 m as 0.7 of it, and gets it through
   * `setGunnerTarget(ac, id, station)` at the station that bears. With nothing in his arcs his
   * override is cleared and the sim's own choice (the nearest enemy his arcs bear on) stands.
   * A man killed (`crewWounds`) gets nothing.
   */
  private stationGunners(self: AircraftEntity, world: WorldQuery, gunners: Map<number, CrewStation[]>, hook: NonNullable<AIControllerOptions['setGunnerTarget']>): void {
    const mates = world.aircraft.filter((a) => a !== self && a.side === self.side && isAlive(a) && a.state.position.distanceToSquared(self.state.position) < 400 * 400);
    const d = new Vector3();
    for (const [crew, stations] of gunners) {
      let pick: number | null = null;
      let at: CrewStationId | undefined;
      if (crewAlive(self, crew)) {
        let best = Infinity;
        for (const e of world.aircraft) {
          if (e.side === self.side || !isAlive(e)) continue;
          const r = e.state.position.distanceTo(self.state.position);
          if (r > 650) continue;
          const st = stationBearing(stations, bodyDirection(self, e.state.position, d));
          if (!st) continue;
          let score = r;
          if (isAttacking(e, self)) score *= 0.5;
          else if (mates.some((m) => isAttacking(e, m))) score *= 0.7;
          if (score < best) {
            best = score;
            pick = e.id;
            at = st.id;
          }
        }
      }
      const prev = this.manTargets.get(crew);
      if (prev && prev.id === pick && prev.station === at) continue;
      if (prev) hook(self, null, prev.station);
      if (pick !== null && at) {
        hook(self, pick, at);
        this.manTargets.set(crew, { id: pick, station: at });
      } else this.manTargets.delete(crew);
    }
  }

  /** Why the pilot is heading home, if he is. */
  get homeReason(): string {
    return this.rtbReason;
  }
}

const ZERO = new Vector3();

/**
 * Cap how far off the current horizontal heading `dir` may point (keeping its climb gradient),
 * so a big reversal is flown as a banked turn toward the target side instead of a pull-through.
 */
function limitTurnDemand(self: AircraftEntity, dir: Vector3, maxAngle: number): void {
  const f = forwardOf(self.state.orientation, _tmp2);
  const fh = Math.atan2(f.x, -f.z);
  const h = Math.hypot(dir.x, dir.z);
  if (h < 1e-6) return;
  const dh = Math.atan2(dir.x, -dir.z);
  const d = wrapPi(dh - fh);
  if (Math.abs(d) <= maxAngle) return;
  const nh = fh + Math.sign(d) * maxAngle;
  const grad = dir.y / h;
  dir.set(Math.sin(nh), grad, -Math.cos(nh));
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function damageSum(ac: AircraftEntity): number {
  let s = 0;
  for (const k in ac.damage.zones) s += ac.damage.zones[k as keyof typeof ac.damage.zones];
  return s;
}

/** Rounds remaining across fixed (forward) guns, counting spare drums. */
export function fixedAmmo(ac: AircraftEntity): number {
  let n = 0;
  for (const gs of ac.guns) {
    const m = ac.spec.guns[gs.mountIndex];
    if (!m || m.mount === 'flexible') continue;
    n += gs.roundsLeft + gs.sparesLeft * m.rounds;
  }
  return n;
}

export function createAIController(ac: AircraftEntity, opts: AIControllerOptions): AIPilot {
  return new AIPilot(ac, opts);
}
