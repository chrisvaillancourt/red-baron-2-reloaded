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
import { angleBetween, clamp, DEG, forwardOf, makeRng, upOf, rightOf } from './math';
import { chooseDefensive, maneuverSteer, type Maneuver } from './maneuvers';
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
import { isAlive, isAttacking, Perception, threatLevel } from './perception';
import { makeSkillProfile, skillValue, type SkillProfile } from './skill';
import { traitsFor, type AircraftTraits } from './traits';

export interface AIControllerOptions {
  role: FlightRole;
  task: MissionFlight['task'];
  skill: SkillLevel;
  /** Entity id of the flight leader (omit for the leader; inferred from flightId if absent). */
  leaderId?: number;
  /** 1-based slot in the leader's vic (odd = right, even = left). */
  formationSlot?: number;
  realism: RealismSettings;
  /** Hook into src/sim combat: point this aircraft's flexible gun(s) at a target. */
  setGunnerTarget?: (ac: AircraftEntity, targetId: number | null) => void;
  /** Where to land when the mission is done (defaults to nearest friendly field). */
  homeAerodromeId?: string;
  /** RNG seed (defaults to the entity id) for reproducible behaviour. */
  seed?: number;
}

export type AIPhase =
  | 'mission'
  | 'formation'
  | 'escort'
  | 'patrol'
  | 'engage'
  | 'extend'
  | 'defend'
  | 'attack-balloon'
  | 'attack-ground'
  | 'rtb'
  | 'landing'
  | 'landed'
  | 'out';

export interface AIStats {
  /** Seconds with a true (noise-free) guns solution on the current target. */
  gunsSolutionTime: number;
  firingTime: number;
  defendTime: number;
}

/** Controllers by entity, so wingmen can see what their leader is doing. */
const REGISTRY = new WeakMap<AircraftEntity, AIPilot>();

export function getAIPilot(ac: AircraftEntity): AIPilot | undefined {
  return REGISTRY.get(ac);
}

type AttackStage = 'approach' | 'run' | 'pullout';

const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _rel = new Vector3();

export class AIPilot implements AIController {
  readonly entityId: number;
  debugState = 'init';
  phase: AIPhase = 'mission';
  readonly stats: AIStats = { gunsSolutionTime: 0, firingTime: 0, defendTime: 0 };
  readonly traits: AircraftTraits;
  readonly profile: SkillProfile;
  readonly autopilot: Autopilot;

  private readonly opts: AIControllerOptions;
  private readonly perception: Perception;
  private readonly rng: () => number;
  private order: WingmanCommand | 'default' = 'default';
  private orderTargetId: number | null = null;

  private now = 0;
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
  private landing: LandingPlan | null = null;
  landingStage: LandingStage = 'approach';
  private gunnerTarget: number | null = null;
  private attackStage: AttackStage = 'approach';
  private attackStageUntil = 0;
  private attackObjId: number | null = null;
  private attackPhaseStarted = -1;
  private leadScale = 1;
  private noise = new Vector3();
  private prevTargetVel = new Vector3();
  private prevTargetId: number | null = null;
  private targetAcc = new Vector3();
  private missionDone = false;
  private loiter: Vector3 | null = null;
  private readonly steer: SteerCommand = { dir: new Vector3(0, 0, -1), speed: Infinity };
  private readonly lead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };
  private readonly trueLead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };

  constructor(ac: AircraftEntity, opts: AIControllerOptions) {
    this.entityId = ac.id;
    this.opts = opts;
    this.traits = traitsFor(ac.spec);
    this.profile = makeSkillProfile(skillValue(opts.skill, opts.role, opts.realism));
    this.perception = new Perception(this.profile);
    this.rng = makeRng(opts.seed ?? ac.id * 7919 + 13);
    this.autopilot = new Autopilot(this.traits, this.profile.maxG, this.profile.groundMargin, ac.spec.performance.rollRate, ac.spec.performance.pitchRate);
    this.lastDamage = damageSum(ac);
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

    this.perception.sweep(self, world, this.rng);
    this.checkDamage(self, world);
    this.checkDisengage(self);
    this.decide(self, world);

    const steer = this.steer;
    steer.aim = false;
    steer.maxG = undefined;
    steer.minAgl = undefined;
    steer.aggression = 1;
    steer.lowLevel = false;
    steer.minSpeed = undefined;
    steer.maxPerformance = false;
    steer.speed = Infinity;
    this.computeSteer(self, world, dt, steer);
    this.avoidCollisions(self, world, steer);
    this.autopilot.fly(self, steer, world, dt);

    this.weapons(self, world, dt);
    this.gunner(self, world);
    if (this.phase === 'defend') this.stats.defendTime += dt;
    this.debugState = `${this.phase}${this.targetId != null ? ` #${this.targetId}` : ''}${this.maneuver ? ` ${this.maneuver.kind}` : ''}${this.autopilot.recovering ? ' recover' : ''}${this.autopilot.groundEmergency ? ' pull-up' : ''}`;
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
        this.perception.notice(att, this.now);
        const e = world.getEntity(att);
        if (e && e.kind === 'aircraft') this.threatId = att;
      }
    }
    this.lastDamage = d;
  }

  private checkDisengage(self: AircraftEntity): void {
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
    else if (self.state.fuelL < 0.12 * self.spec.performance.fuelCapacityL) reason = 'low fuel';
    else if (this.traits.hasFixedGuns && this.opts.task !== 'recon' && this.opts.task !== 'bomb' && fixedAmmo(self) === 0) reason = 'out of ammunition';
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
      if (l && l.kind === 'aircraft' && isAlive(l)) return l;
    }
    let lowest: AircraftEntity | null = null;
    for (const a of world.aircraft) {
      if (a.flightId !== self.flightId || !isAlive(a)) continue;
      if (!lowest || a.id < lowest.id) lowest = a;
    }
    if (!lowest || lowest.id === self.id) return null;
    // A leader that has gone home/landed no longer leads.
    const lc = REGISTRY.get(lowest);
    if (lc && (lc.phase === 'landed' || lc.phase === 'landing') && this.phase !== 'rtb') return null;
    return lowest;
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

    if (maxThreat >= p.defensiveThreshold && !fixated) {
      if (this.threatSince < 0) this.threatSince = this.now;
      if (this.now - this.threatSince >= p.reactionDelay) {
        const expired = !this.maneuver || this.now >= this.maneuver.until;
        if (this.phase !== 'defend' || expired) {
          // Aces reverse onto an attacker that has overshot.
          if (attacker && p.t > 0.6 && this.phase === 'defend' && this.overshot(self, attacker)) {
            this.maneuver = null;
            this.threatSince = -1;
            this.targetId = attacker.id;
            this.phase = this.phase === 'defend' ? 'engage' : this.phase;
            return;
          }
          const agl = self.state.heightAboveGround;
          this.maneuver = chooseDefensive(self, attacker, this.traits, p, agl, this.now, this.rng);
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

    if (this.phase === 'rtb' || this.phase === 'landing') return;

    // ---- engagement ------------------------------------------------------
    if (this.phase === 'extend' && this.now < this.extendUntil) return;
    const target = this.chooseTarget(self, world, known);
    if (target) {
      this.targetId = target.id;
      this.phase = 'engage';
      return;
    }
    this.targetId = null;
    if (this.phase === 'engage' || this.phase === 'extend') this.phase = 'mission';
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
        this.perception.notice(e.id, this.now);
        return e;
      }
      this.order = 'engage-at-will';
    }
    if (known.length === 0) return null;
    // Balloon/ground-attack flights only fight when attacked (handled by defence).
    if ((task === 'balloon-attack' || task === 'ground-attack') && this.phase !== 'engage') {
      const close = known.find((e) => e.state.position.distanceTo(self.state.position) < 500 && isAttacking(e, self, 600));
      if (!close) return null;
    }

    // Engagement radius depends on role and orders.
    let radius = this.profile.spotRange * 0.8;
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

    let best: AircraftEntity | null = null;
    let bestScore = -Infinity;
    for (const e of known) {
      const r = e.state.position.distanceTo(self.state.position);
      let inScope = e.state.position.distanceTo(anchor) < radius || r < 900;
      if (escortees.length) inScope = escortees.some((m) => m.state.position.distanceTo(e.state.position) < radius) || r < 700;
      if (this.order === 'cover-me' && leader) inScope = isAttacking(e, leader, 1000) || (r < 500 && isAttacking(e, self, 600));
      if (!inScope) continue;
      let s = 1 / (1 + r / 800);
      if (leader && isAttacking(e, leader)) s += 0.6;
      for (const m of escortees) if (isAttacking(e, m, 900)) s += 0.7;
      if (isAttacking(e, self)) s += 0.4;
      if (damageSum(e) > 0.3 || e.damage.smoking) s += 0.25;
      if (task === 'defend' && e.spec.role !== 'fighter') s += 0.5;
      if (this.traits.style === 'energy' && e.state.position.y > self.state.position.y + 500) s -= 0.2;
      // Spread targets across the flight.
      for (const a of world.aircraft) {
        if (a === self || a.side !== self.side) continue;
        const ctl = REGISTRY.get(a);
        if (ctl && ctl.targetId === e.id) s -= 0.15;
      }
      if (e.id === this.targetId) s *= 1.4;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
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
      return;
    }
    // Leader: escort station, else waypoints.
    if (this.opts.task === 'escort') {
      const es = this.escortees(self, world);
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
      case 'land': {
        const a = nearestFriendlyAerodrome(self.side, wp.x, wp.z, world.date);
        if (a && dist < 5000) {
          this.landing = planLanding(a, (x, z) => world.groundHeightAt(x, z));
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
    this.patrolUntil = -1;
    this.wpStarted = -1;
    this.attackPhaseStarted = -1;
    this.attackObjId = null;
    this.attackStage = 'approach';
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

    // Too close: break off to avoid a collision.
    if (r < 55 && closure > 3) {
      this.startExtend(2.5);
      steer.dir.copy(upOf(s.orientation, _tmp2)).addScaledVector(f, 0.5);
      return true;
    }
    // Energy fighters extend after a pass instead of turning.
    if (this.traits.style === 'energy' && p.t > 0.3 && passed && s.velocity.length() > tSpeed + 5 && angleOff > 60 * DEG) {
      this.startExtend(5 + 3 * this.rng());
      return true;
    }

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
      leadSolution(s.position, s.velocity, ts.position, ts.velocity, this.targetAcc, mv, this.leadScale, this.lead);
      const dir = steer.dir.copy(this.lead.dir);
      this.applyAimNoise(self, dir, dt);
      steer.aim = true;
      // Overshoot guard: lag pursuit and throttle back when closing fast at high angle-off.
      if (r < 280 && closure > 18 && angleOff > 45 * DEG) {
        const behind = ts.position.clone().addScaledVector(_tmp2.copy(ts.velocity).normalize(), -120).sub(s.position);
        steer.dir.copy(behind);
        steer.aim = false;
      }
      // Range hold on the six: close to ~110 m and stay there rather than overshooting.
      if (r < 450 && angleOff < 70 * DEG) steer.speed = Math.max(tSpeed + clamp((r - 110) * 0.2, -15, 40), this.traits.stallSpeed * 1.45);
      // Rear gunner caution: approach two-seaters from below.
      if (tgt.spec.geometry.crew === 2 && r > 250 && p.t > 0.5) steer.dir.y -= 0.06;
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

  private startExtend(seconds: number): void {
    this.phase = 'extend';
    this.extendUntil = this.now + seconds;
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

  /** Ornstein-Uhlenbeck aim wander, rotating dir by small angles. */
  private applyAimNoise(self: AircraftEntity, dir: Vector3, dt: number): void {
    const sigma = this.profile.aimNoiseRad;
    const theta = 1.2;
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
    if (fixedAmmo(self) === 0) return false;
    let obj: BalloonEntity | GroundTargetEntity | undefined;
    if (this.attackObjId != null) {
      const e = world.getEntity(this.attackObjId);
      if (e && (e.kind === 'balloon' ? !e.destroyed && !e.burning : e.kind === 'ground' && !e.destroyed)) obj = e as BalloonEntity | GroundTargetEntity;
    }
    if (!obj) {
      const list: (BalloonEntity | GroundTargetEntity)[] = balloon ? world.balloons.filter((b) => !b.destroyed && !b.burning) : world.groundTargets.filter((g) => !g.destroyed);
      let bd = 5000;
      for (const o of list) {
        if (o.side === self.side) continue;
        const d = Math.hypot(o.position.x - wp.x, o.position.z - wp.z);
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
    const setupAlt = balloon ? tp.y + 350 : gy + 320;
    const diveStart = balloon ? 1500 : 1300;
    steer.speed = Infinity;
    steer.maxG = 3.5;
    if (this.attackStage === 'pullout') {
      if (this.now < this.attackStageUntil) {
        const away = _tmp2.set(-_rel.x, 0, -_rel.z).normalize();
        steer.dir.copy(away).add(new Vector3(0, 0.45, 0));
        steer.lowLevel = true;
        return true;
      }
      this.attackStage = 'approach';
    }
    if (this.attackStage === 'approach') {
      if (horiz < diveStart * 0.8) {
        // Too close to start a run: open the distance.
        const away = _tmp2.set(-_rel.x, 0, -_rel.z).normalize();
        steer.dir.copy(away);
        steer.dir.y = clamp((setupAlt - s.position.y) / 400, -0.3, 0.3);
        return true;
      }
      steer.dir.copy(toPointSteer(self, tp.x, setupAlt, tp.z));
      const facing = angleBetween(forwardOf(s.orientation, _tmp), _tmp2.set(_rel.x, 0, _rel.z));
      if (horiz < diveStart && facing < 25 * DEG) this.attackStage = 'run';
      return true;
    }
    // Attack run: dive on the target, guns solution for a static target.
    leadSolution(s.position, s.velocity, tp, ZERO, null, this.traits.fixedMuzzleVelocity || 800, 1, this.lead);
    steer.dir.copy(this.lead.dir);
    steer.aim = r < 700;
    steer.lowLevel = true;
    steer.minAgl = 30;
    const agl = s.position.y - world.groundHeightAt(s.position.x, s.position.z);
    if (r < (balloon ? 90 : 140) || agl < 45 || _rel.dot(forwardOf(s.orientation, _tmp)) < 0) {
      this.attackStage = 'pullout';
      this.attackStageUntil = this.now + 5;
    }
    return true;
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
    if (home) {
      const d = Math.hypot(home.x - s.position.x, home.z - s.position.z);
      if (d < 4500 && !threatened) {
        this.landing = planLanding(home, (x, z) => world.groundHeightAt(x, z));
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
    if (this.landingStage === 'approach') {
      const ap = plan.approachPoint;
      steer.dir.copy(toPointSteer(self, ap.x, ap.y, ap.z));
      steer.speed = vs * 1.7;
      steer.minAgl = 120;
      const d = Math.hypot(ap.x - s.position.x, ap.z - s.position.z);
      if (d < 450) this.landingStage = 'final';
      return;
    }
    if (this.landingStage === 'final') {
      const ahead = along + 300;
      const aim = plan.threshold.clone().addScaledVector(plan.dir, ahead);
      aim.y = plan.threshold.y + Math.max(0, -ahead) * Math.tan(5 * DEG) + 1;
      steer.dir.copy(aim.sub(s.position));
      steer.speed = vs * 1.35;
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
    // Flare: level off just above the grass and let the speed bleed away.
    // Hold a shallow sink with a whisker of power, then cut it for the touchdown.
    steer.dir.copy(plan.dir);
    steer.dir.y = clamp(-0.004 - agl * 0.004, -0.04, -0.004);
    steer.speed = agl > 1.5 ? vs * 1.15 : 0;
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
      if (o === self || !isAlive(o)) continue;
      const rel = _tmp2.copy(o.state.position).sub(s.position);
      const r = rel.length();
      if (r > 250) continue;
      const relV = o.state.velocity.clone().sub(s.velocity);
      const vv = relV.lengthSq();
      const tcpa = vv > 1e-3 ? clamp(-rel.dot(relV) / vv, 0, 3) : 0;
      const cpa = rel.clone().addScaledVector(relV, tcpa);
      const dcpa = cpa.length();
      const radius = 30;
      if (dcpa >= radius) continue;
      const w = (1 - dcpa / radius) * (1 - tcpa / 3.2);
      if (dcpa < 1) cpa.copy(upOf(s.orientation, new Vector3())).negate();
      avoid.addScaledVector(cpa.normalize(), -w);
      wsum += w;
    }
    if (wsum > 0.05) {
      steer.dir.normalize().addScaledVector(avoid.normalize(), clamp(wsum * 3, 0, 3)).normalize();
      steer.aim = false;
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
      leadSolution(s.position, s.velocity, e.state.position, e.state.velocity, e === cur ? this.targetAcc : null, mv, 1, this.trueLead);
      const trueErr = angleBetween(f, this.trueLead.dir);
      const size = angularRadius(Math.max(3, e.spec.geometry.span * 0.4), r);
      if (e === cur && trueErr < size + 0.5 * DEG && r < 400) this.stats.gunsSolutionTime += dt;
      // Perceived error: the pilot's own (imperfect) solution.
      leadSolution(s.position, s.velocity, e.state.position, e.state.velocity, e === cur ? this.targetAcc : null, mv, this.leadScale, this.lead);
      const err = angleBetween(f, this.lead.dir) + Math.abs(gauss(this.rng)) * p.aimNoiseRad * 0.5;
      const range = e === cur ? p.fireRange : p.fireRange * 0.7;
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
        leadSolution(s.position, s.velocity, o.position, ZERO, null, mv, 1, this.lead);
        const size = angularRadius(o.kind === 'balloon' ? 9 : 4, r);
        if (r < (o.kind === 'balloon' ? 350 : 450) && angleBetween(f, this.lead.dir) < size + p.fireConeRad) want = true;
      }
    }
    if (want && !this.lineOfFireClear(self, world, f)) want = false;

    if (want) {
      if (this.now >= this.burstUntil && this.now >= this.burstNext) {
        this.burstUntil = this.now + p.burstLength * (0.7 + 0.6 * this.rng());
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
    let pick: number | null = null;
    if (self.damage.zones.gunner < 1) {
      const back = forwardOf(self.state.orientation, new Vector3()).negate();
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

  /** Why the pilot is heading home, if he is. */
  get homeReason(): string {
    return this.rtbReason;
  }
}

const ZERO = new Vector3();

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
