/**
 * Low-level autopilot: turns a desired flight-path direction + speed into
 * stick, rudder and throttle.
 *
 * Bank-to-turn "lift vector" control:
 *   1. The desired direction gives a commanded turn rate -> lateral accel.
 *   2. Adding gravity compensation gives the total lift acceleration needed.
 *   3. Roll puts the lift vector (body up) on that acceleration; pitch
 *      (PI loop on measured g-load, with feed-forward) sets its magnitude.
 *   4. Rudder nulls sideslip (plus fine nose-pointing when aiming guns).
 *   5. Throttle holds airspeed (PI).
 * Layered safety: stall margin via AoA and speed-based available g, a stall
 * recovery routine, and ground avoidance with look-ahead.
 *
 * Everything the loops need is measured from FlightState (orientation,
 * velocity, gLoad, aoa, stalled) or computed locally, so the controller
 * is portable across flight models; only gains need retuning.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import type { WorldQuery } from '../core/interfaces';
import { angleBetween, clamp, DEG, G, headingOf, WORLD_UP, wrapPi } from './math';
import type { AircraftTraits } from './traits';
import { stickForAlpha, tailPressureRatio } from '../sim/flightModel';
import type { FlightCoefficients } from '../sim/coefficients';

export interface SteerCommand {
  /** Desired flight-path direction, world frame (need not be unit length). */
  dir: Vector3;
  /** Desired true airspeed, m/s. Infinity = full throttle, 0 = idle. */
  speed: number;
  /** Point the nose (gun line) rather than the flight path along `dir`. */
  aim?: boolean;
  /** Max load factor for this frame. */
  maxG?: number;
  /** Height above ground the ground-avoidance layer defends, m. */
  minAgl?: number;
  /** Turn-rate gain multiplier (1 = normal). */
  aggression?: number;
  /** Allow flying below the ground margin (strafing, landing). */
  lowLevel?: boolean;
  /** Speed below which climbs are flattened to protect energy (default 1.4 x stall). */
  minSpeed?: number;
  /** Landing approach: slow flight near the ground is intended (no low-altitude speed floor). */
  landing?: boolean;
  /** Max-performance turn: allow over-banking (trading height for turn) instead of a level-turn cap. */
  maxPerformance?: boolean;
}

export interface AutopilotGains {
  turnKp: number; // commanded turn rate per rad of heading error, 1/s
  turnKd: number;
  rollKp: number;
  rollKd: number;
  gFeedForward: number; // stick per g above 1
  gKp: number;
  gKi: number;
  slipK: number;
  aimYawK: number;
  speedKp: number;
  speedKi: number;
  /** Gain on the desired-direction rotation rate (1 = full feed-forward). */
  losFeedForward: number;
}

export function defaultGains(rollRate: number, pitchRate: number): AutopilotGains {
  const rr = Math.max(0.4, rollRate);
  const pr = Math.max(0.4, pitchRate);
  return {
    turnKp: 2.2,
    turnKd: 0.5,
    rollKp: 1.2 + 0.9 * (1 - rr),
    rollKd: 0.22,
    gFeedForward: 0.2 / Math.sqrt(pr),
    gKp: 0.12,
    gKi: 0.45,
    slipK: 2.5,
    aimYawK: 3.5,
    speedKp: 0.06,
    speedKi: 0.04,
    losFeedForward: 1.0,
  };
}

const _f = new Vector3();
const _u = new Vector3();
const _r = new Vector3();
const _v = new Vector3();
const _d = new Vector3();
const _ref = new Vector3();
const _perp = new Vector3();
const _a = new Vector3();
const _g = new Vector3();
const _p = new Vector3();
const _vb = new Vector3();
const _ff = new Vector3();
const _qInv = new Quaternion();
// Scratch for groundCheck only (fly() holds _f/_u/_r/_v/_p across the call).
const _gcV = new Vector3();
const _gcUp = new Vector3();
const _gcR = new Vector3();
const _gcU = new Vector3();

export class Autopilot {
  gains: AutopilotGains;
  /** Debug/telemetry. */
  recovering = false;
  groundEmergency = false;
  lastNDes = 1;
  lastRollErr = 0;
  dbg = "";
  /** Build the per-tick `dbg` string (tuning probes only; allocates every tick). */
  trace = false;

  private gI = 0;
  private thrI = 0;
  private prevTheta = 0;
  private prevD = new Vector3();
  private hasPrevD = false;
  private prevRollErr = 0;
  private rollSign = 1;
  private prevHeading = 0;
  private first = true;
  /** Seconds of fly() calls (the autopilot's own clock). */
  private clock = 0;
  private recoverSince = 0;
  /** Learned fraction of the estimated available g actually usable before stalling. */
  availScale = 1;
  /** 0 = careless (novice) .. 1 = keeps a wide structural margin (ace). */
  diveCaution = 0.6;
  /**
   * AoA kept below the stall, degrees. Independent of diveCaution (which governs the
   * structural/dive margin): an assist for a beginner wants a wide stall margin *and* a
   * wide structural one. null = derive from diveCaution (AI pilots: aces fly closer to
   * the edge, ~1.0 deg, novices ~2.2 deg).
   */
  stallMarginDeg: number | null = null;
  /** Last tail/free-stream pressure ratio used by the pitch law (telemetry). */
  tailRatio = 1;
  /** 0..1 how far into the dive-speed governor band we are (telemetry). */
  overspeed = 0;
  /** Load factor the airframe tolerates now (wing damage lowers it), with a margin. */
  structuralG = 6;
  /** Effective never-exceed speed now (wing damage lowers it). */
  vneNow = 80;
  private wasStalled = false;

  /**
   * Flight-model coefficients for the model-inverse control law. When set, stick
   * and aileron are computed by inverting src/sim's pitch (stick -> AoA) and roll
   * (stick -> roll rate ~ V) laws, with small PI trims; this schedules the gains
   * with dynamic pressure automatically. When null, the generic PID law is used
   * (any flight model honouring the ControlInputs sign conventions).
   */
  private readonly co: FlightCoefficients | null;
  private alphaI = 0;
  /** Low-passed rotation rate of the desired direction (LOS-rate feed-forward). */
  private readonly losRate = new Vector3();
  private rollRateI = 0;

  constructor(
    private readonly traits: AircraftTraits,
    private readonly defaultMaxG: number,
    private readonly defaultMinAgl: number,
    rollRate: number,
    pitchRate: number,
    coefficients: FlightCoefficients | null = null,
  ) {
    this.gains = defaultGains(rollRate, pitchRate);
    this.co = coefficients;
  }

  /**
   * Model-inverse law (src/sim):
   *   pitch: alphaCmd = alphaTrim + stick * (alphaCmdMax - alphaTrim)  (stick >= 0), and the
   *          airframe follows alphaCmd quickly, so the stick for a load factor n is
   *          stickForAlpha(alpha0 + n W / (q S CLa)). An integral on g error, expressed
   *          as an AoA correction (d alpha / d n = W / (q S CLa)), absorbs thrust/damage.
   *   roll:  steady roll rate p = rollSteady * (V / vRef) * stick, i.e. stick = p / (K V)
   *          with K = rollAuthority / (2 rollDamping); a roll-rate loop on the measured
   *          rate (p = -angularVelocity.z) plus a small integral fights torque and damage.
   */
  private modelLaw(ac: AircraftEntity, rollErr: number, nDes: number, world: WorldQuery, dt: number): void {
    const co = this.co!;
    const s = ac.state;
    const c = ac.controls;
    const V = Math.max(8, s.airspeed);
    const rho = world.env.airDensityAt(s.position.y);
    const qS = 0.5 * rho * V * V * co.wingArea;
    const dAlphaDn = co.weight / (qS * co.clAlpha);

    // ---- pitch --------------------------------------------------------------
    const gErr = nDes - s.gLoad;
    const margin = this.stallMarginRad();
    const nearStall = s.stalled || s.aoa > co.alphaStall - margin * 0.6;
    if (nearStall) this.alphaI = Math.min(this.alphaI, 0) - 2 * DEG * dt;
    else this.alphaI = clamp(this.alphaI + 0.8 * gErr * dAlphaDn * dt, -3 * DEG, 3 * DEG);
    // Pitch-damping lag: in a sustained pull the airframe settles short of the commanded
    // AoA by pitchDamping * rho * V * q / (pitchStiffness * qDyn). Feed the expected
    // flight-path rotation rate q = g (n - cos(bank)cos(pitch)) / V forward.
    const up = _u.set(0, 1, 0).applyQuaternion(s.orientation);
    const qExp = Math.max(0, (G * (nDes - up.y)) / V);
    const lag = (co.pitchDamping * rho * V * qExp) / (co.pitchStiffness * 0.5 * rho * V * V);
    let alpha = co.alpha0 + nDes * dAlphaDn + 0.25 * gErr * dAlphaDn + this.alphaI;
    // The margin protects the *settled* wing AoA.
    alpha = Math.min(alpha, co.alphaStall - margin);
    // The sim settles where the tail AoA (wing AoA / tail pressure ratio) meets the
    // command, less the pitch-damping lag: under power at low speed the propeller
    // slipstream would otherwise carry the wing past the stall.
    this.tailRatio = tailPressureRatio(ac, world.env);
    // A wounded pilot's pull is weaker (src/sim: pilotStrength); ask for more stick.
    const stick = stickForAlpha(co, (alpha + lag) / this.tailRatio);
    c.pitch = clamp(stick > 0 ? stick / (1 - 0.35 * ac.damage.zones.pilot) : stick, -1, 1);

    // ---- roll -----------------------------------------------------------------
    const K = co.rollAuthority / (2 * co.rollDamping);
    const p = -s.angularVelocity.z;
    const pMax = Math.min(K * V, 3.5);
    const pCmd = clamp(3.2 * rollErr, -pMax, pMax);
    const pErr = pCmd - p;
    // Integral trims steady torque/damage roll only; it is frozen and bled off during
    // large bank changes, where it would wind up and roll the aircraft past the target.
    if (Math.abs(rollErr) < 0.35) this.rollRateI = clamp(this.rollRateI + 0.6 * pErr * dt, -0.25 * K * V, 0.25 * K * V);
    else this.rollRateI *= 1 - clamp(dt * 3, 0, 1);
    c.roll = clamp((pCmd + 0.35 * pErr + this.rollRateI) / (K * V), -1, 1);
  }

  /** Stall margin in radians (see stallMarginDeg). */
  stallMarginRad(): number {
    return (this.stallMarginDeg ?? 2.2 - 1.2 * this.diveCaution) * DEG;
  }

  reset(): void {
    this.gI = 0;
    this.thrI = 0;
    this.first = true;
  }

  /** Current bank angle, rad (positive = right wing down). */
  static bankAngle(ac: AircraftEntity): number {
    const q = ac.state.orientation;
    _r.set(1, 0, 0).applyQuaternion(q);
    _u.set(0, 1, 0).applyQuaternion(q);
    return Math.atan2(-_r.y, _u.y);
  }

  fly(ac: AircraftEntity, cmd: SteerCommand, world: WorldQuery, dt: number): void {
    const s = ac.state;
    const c = ac.controls;
    const k = this.gains;
    const q = s.orientation;
    const f = _f.set(0, 0, -1).applyQuaternion(q);
    const u = _u.set(0, 1, 0).applyQuaternion(q);
    const r = _r.set(1, 0, 0).applyQuaternion(q);
    const V = Math.max(1, s.velocity.length());
    const vhat = _v.copy(s.velocity).divideScalar(V);
    if (V < 2) vhat.copy(f);
    const heading = headingOf(f);
    if (this.first) {
      this.prevHeading = heading;
      this.first = false;
    }
    this.clock += dt;
    const headingRate = wrapPi(heading - this.prevHeading) / Math.max(dt, 1e-3);
    this.prevHeading = heading;

    // Structural envelope (mirrors the sim: wing damage lowers both limits).
    const wd = Math.max(ac.damage.zones.leftWing, ac.damage.zones.rightWing);
    this.structuralG = this.traits.gLimit * (1 - 0.5 * wd) * 0.85;
    this.vneNow = this.traits.vne * (1 - 0.3 * wd);

    c.blip = false;
    if (s.onGround && cmd.speed === 0) {
      // Rollout: stick back holds the tail down; aileron keeps the wings level (a
      // dropped wingtip at speed is a crash) and rudder tracks the landing direction.
      const bk = Math.atan2(-r.y, u.y);
      c.pitch = 0.3;
      c.roll = clamp(-bk * 2.5 + s.angularVelocity.z * 0.5, -1, 1);
      const hdgErr = wrapPi(headingOf(cmd.dir) - heading);
      c.yaw = clamp(hdgErr * 2 + s.angularVelocity.y * 0.6, -1, 1);
      c.throttle = 0;
      return;
    }

    const bank = Math.atan2(-r.y, u.y);
    const maxG = cmd.maxG ?? this.defaultMaxG;
    // Available g before the wing stalls, from the speed/stall-speed ratio.
    const rhoRatio = world.env.airDensityAt(s.position.y) / 1.225;
    const nAvail = Math.max(0.5, (V / this.traits.stallSpeed) ** 2 * rhoRatio);
    // Energy-aware g: near the stall a sustained max-g turn bleeds the last of the speed
    // and ends in a stall (the low-level killer). Taper the usable g toward 1 as the true
    // airspeed approaches ~1.12 Vs so the aircraft flies out and accelerates instead.
    const vsTrue = this.traits.stallSpeed / Math.sqrt(Math.max(0.2, rhoRatio));
    const energyK = clamp((V / vsTrue - 1.12) / 0.28, 0, 1);
    const nUsable = cmd.landing ? nAvail * 0.92 * this.availScale : 1 + (nAvail * 0.92 * this.availScale - 1) * (0.2 + 0.8 * energyK);

    // ---- desired direction, with ground avoidance ------------------------
    const d = _d.copy(cmd.dir);
    if (d.lengthSq() < 1e-9) d.copy(vhat);
    d.normalize();
    const minAgl = cmd.minAgl ?? this.defaultMinAgl;
    // Emergency pull-ups may exceed the comfortable structural cap: the ground is certain death.
    const nPull = Math.min(Math.max(maxG, 4), nAvail * 0.9 * this.availScale, this.structuralG);
    const ground = this.groundCheck(ac, world, minAgl, cmd.lowLevel === true, nPull);
    this.groundEmergency = ground.emergency;
    // Energy floor: don't ask for a climb the aircraft can't sustain.
    const vs = this.traits.stallSpeed;
    const minSpeed = cmd.minSpeed ?? vs * 1.4;
    const deficit = clamp((minSpeed - V) / (0.3 * vs), 0, 1);
    if (deficit > 0 && d.y > -0.1) {
      const h = Math.hypot(d.x, d.z) || 1;
      d.y = Math.min(d.y, 0.6 * (1 - deficit)) - 0.12 * deficit;
      d.x /= h;
      d.z /= h;
      d.normalize();
    }
    // Dive governor: steep dives are capped, and the cap closes toward level flight
    // as airspeed approaches Vne (the sim fails the airframe beyond it). Careless
    // (novice) pilots react later and can overstress; aces keep a wide margin.
    const vr = V / this.vneNow;
    const govStart = 0.8 + 0.08 * (1 - this.diveCaution);
    const govEnd = 0.93 + 0.06 * (1 - this.diveCaution);
    this.overspeed = clamp((vr - govStart) / (govEnd - govStart), 0, 1);
    const maxDive = (cmd.lowLevel ? 80 : 72) * DEG * (1 - this.overspeed);
    if (d.y < -Math.sin(maxDive)) {
      const h = Math.hypot(d.x, d.z);
      if (h > 1e-3) {
        d.x /= h;
        d.z /= h;
      } else {
        const hv = Math.hypot(vhat.x, vhat.z) || 1;
        d.x = vhat.x / hv;
        d.z = vhat.z / hv;
      }
      const c = Math.cos(maxDive);
      d.x *= c;
      d.z *= c;
      d.y = -Math.sin(maxDive) + (this.overspeed > 0.6 ? 0.25 * (this.overspeed - 0.6) : 0);
      d.normalize();
    }
    if (ground.climb > 0 && d.y < ground.climb) {
      // Strong terrain warnings also wash out lateral demands so the wings come level.
      const w = clamp((ground.climb - 0.2) / 0.4, 0, 1);
      if (w > 0) d.lerp(_p.set(vhat.x, 0, vhat.z).normalize(), w);
      d.y = ground.climb;
      d.normalize();
    }

    // ---- stall recovery --------------------------------------------------
    const stallish = s.stalled || (V < this.traits.stallSpeed * 0.92 && !s.onGround);
    if (stallish && !this.recovering) {
      this.recovering = true;
      this.recoverSince = this.clock;
    }
    // Unstalled with flying speed back: resume. Near the ground there is no height to
    // dive for 1.35 Vs, and sitting in a wings-level 0.7 g recovery is what gets a scout
    // shot or flown into the ground, so accept a lower (still manoeuvrable) speed there.
    const exitSpeed = s.heightAboveGround < 400 ? 1.15 : 1.25;
    if (this.recovering && !s.stalled && this.clock - this.recoverSince > 0.3 && V > this.traits.stallSpeed * exitSpeed && s.aoa < this.traits.stallAoa - this.stallMarginRad()) this.recovering = false;
    // Touching down power-off is not a stall to recover from.
    if (cmd.lowLevel && cmd.speed === 0 && s.heightAboveGround < 4) this.recovering = false;

    let rollErr: number;
    let nDes: number;
    let yaw = 0;

    // Roll that puts the lift vector in the vertical plane of the flight path, belly
    // toward the ground (well defined in steep dives, unlike the bank angle; 0 when
    // the path is vertical, where any pull reduces the dive).
    const upPerp = _g.copy(WORLD_UP).addScaledVector(vhat, -vhat.y);
    const levelRollErr = upPerp.length() > 0.15 ? Math.atan2(upPerp.dot(r), upPerp.dot(u)) : 0;
    const diveRecovery = !this.recovering && !ground.emergency && this.overspeed > 0.45 && vhat.y < -0.35;

    if (this.recovering) {
      rollErr = s.stalled && Math.abs(bank) < 1.6 ? -bank : levelRollErr;
      // Unload while stalled; once flying, hold what the wing can carry (up to 1 g)
      // instead of a fixed 0.7 g that sinks the aircraft.
      nDes = s.stalled ? 0.3 : clamp(nAvail * 0.8 * this.availScale, 0.7, 1);
      if (Math.abs(headingRate) > 0.6) yaw = -Math.sign(headingRate);
      c.throttle = 1;
    } else if (ground.emergency || diveRecovery) {
      rollErr = levelRollErr;
      const pull = ground.emergency ? nPull : this.structuralG * 0.75;
      nDes = Math.abs(rollErr) > 1.2 ? 0.8 : pull * clamp(Math.cos(rollErr) * 1.4, 0.3, 1);
    } else {
      const ref = cmd.aim ? _ref.copy(f) : _ref.copy(vhat);
      const theta = angleBetween(ref, d);
      const dTheta = (theta - this.prevTheta) / Math.max(dt, 1e-3);
      this.prevTheta = theta;
      const perp = _perp.copy(d).addScaledVector(ref, -d.dot(ref));
      if (perp.lengthSq() > 1e-10) perp.normalize();
      else perp.set(0, 0, 0);
      // Beyond 90 deg the perpendicular vanishes at 180: bias toward "up" to break the tie.
      if (theta > 2.8 && perp.lengthSq() === 0) perp.copy(u);
      const omegaMax = (maxG * G) / V;
      const aggr = cmd.aggression ?? 1;
      // Aiming the nose: the nose leads the flight path by the AoA, which grows with g
      // (d alpha / d n = W / (q S CLa)), so a nose-error loop feeds back through the AoA. Cap
      // its gain so that loop stays below ~0.5, else it porpoises (worst when slow).
      let kTurn = k.turnKp * aggr;
      if (cmd.aim && this.co) {
        const qS = 0.5 * world.env.airDensityAt(s.position.y) * V * V * this.co.wingArea;
        const dAlphaDn = this.co.weight / (qS * this.co.clAlpha);
        kTurn = Math.min(kTurn, (0.5 * G) / (V * dAlphaDn));
      }
      const omega = clamp(kTurn * theta + k.turnKd * Math.min(0, dTheta), 0, omegaMax);
      const gComp = _g.copy(WORLD_UP).addScaledVector(ref, -WORLD_UP.dot(ref)).multiplyScalar(G);
      // Don't ask for more turn than the wing can give on top of carrying our weight,
      // otherwise the bank overshoots and the nose drops in every turn.
      const nLim = Math.min(maxG, nUsable) * G;
      const b = perp.dot(gComp);
      const disc = b * b - (gComp.lengthSq() - nLim * nLim);
      const aLatMax = disc > 0 ? Math.max(0, -b + Math.sqrt(disc)) : 0;
      const a = _a.copy(perp).multiplyScalar(omega * V);
      // Feed-forward the rotation of the desired direction (line-of-sight rate), so a
      // turning target is tracked without the steady-state lag of a pure P loop.
      // The raw rate is differentiated from a noisy aim point, so low-pass it (~0.25 s)
      // and cap it: an unfiltered kick at close range can roll the aircraft the wrong way.
      if (this.hasPrevD && this.prevD.angleTo(d) < 0.25) {
        const dd = _ff.copy(d).sub(this.prevD).divideScalar(Math.max(dt, 1e-3));
        dd.addScaledVector(ref, -dd.dot(ref));
        this.losRate.lerp(dd, clamp(dt / 0.25, 0, 1));
      } else {
        this.losRate.set(0, 0, 0);
      }
      const ffAcc = _ff.copy(this.losRate).multiplyScalar(V * k.losFeedForward);
      if (ffAcc.length() > 2.5 * G) ffAcc.setLength(2.5 * G);
      a.add(ffAcc);
      // Trading height for turn is only sensible with height to spare.
      const sinkOk = cmd.maxPerformance && s.heightAboveGround > minAgl * 3;
      const aLatCap = sinkOk ? omegaMax * V : Math.max(aLatMax, 0.3 * G);
      if (a.length() > aLatCap) a.setLength(aLatCap);
      a.add(gComp);
      if (this.trace) this.dbg = `th=${(theta * 57.3).toFixed(1)} om=${omega.toFixed(2)} perp=(${perp.dot(r).toFixed(2)},${perp.dot(u).toFixed(2)}) ff=(${(ffAcc.dot(r) / G).toFixed(2)},${(ffAcc.dot(u) / G).toFixed(2)}) cap=${(aLatCap / G).toFixed(2)} g=(${(gComp.dot(r) / G).toFixed(2)},${(gComp.dot(u) / G).toFixed(2)})`;
      const ax = a.dot(r);
      const ay = a.dot(u);
      const mag = Math.hypot(ax, ay);
      // Small corrections that need the lift vector below the wings (the nose has drifted
      // a little above the aim point): push, keeping the wings where they are, instead of
      // rolling inverted to "pull" down - which is a split-S reflex for a 5 degree error.
      const push = ay < 0 && theta < 25 * DEG && -ay < 1.4 * G && Math.abs(ax) < -ay * 1.5;
      if (mag < 0.35 * G) {
        rollErr = -bank;
        nDes = ay / G;
      } else if (push) {
        rollErr = Math.atan2(-ax, -ay);
        nDes = -mag / G;
      } else {
        rollErr = Math.atan2(ax, ay);
        // Hysteresis near inverted to avoid dithering between +/-180.
        if (Math.abs(rollErr) > 2.8 && Math.sign(rollErr) !== this.rollSign) rollErr = -rollErr;
        nDes = mag / G;
      }
      if (nDes > 1) nDes = 1 + (nDes - 1) * clamp(Math.cos(rollErr) * 1.3, 0, 1);
      if (Math.abs(rollErr) > 1.2) nDes = Math.min(nDes, 0.6);
      // Fine nose pointing with rudder when aiming.
      if (cmd.aim && theta < 0.07) {
        const lateral = Math.atan2(d.dot(r), d.dot(f));
        yaw += clamp(lateral * k.aimYawK * 10, -0.6, 0.6);
      }
    }
    if (Math.abs(rollErr) > 0.2) this.rollSign = Math.sign(rollErr) || 1;

    // ---- load-factor limits ---------------------------------------------
    const stallAoa = this.traits.stallAoa;
    if (s.aoa > stallAoa * 0.85) nDes = Math.min(nDes, s.gLoad * 0.92);
    if (s.aoa > stallAoa) nDes = Math.min(nDes, 0.5);
    // Pulling out of an overspeed dive may use more than the comfortable cap.
    const gCap = ground.emergency ? nPull : Math.max(maxG, this.overspeed > 0 ? this.structuralG * 0.8 : 0);
    nDes = Math.min(nDes, gCap, ground.emergency ? nAvail * 0.92 * this.availScale : nUsable, this.structuralG);
    nDes = Math.max(nDes, -Math.min(1.5, this.structuralG * 0.3));
    this.lastNDes = nDes;
    this.prevD.copy(d);
    this.hasPrevD = true;

    const dRoll = wrapPi(rollErr - this.prevRollErr) / Math.max(dt, 1e-3);
    this.prevRollErr = rollErr;
    this.lastRollErr = rollErr;
    // Adapt to the real stall boundary: each fresh stall trims the usable g.
    if (s.stalled && !this.wasStalled) this.availScale = Math.max(0.55, this.availScale * 0.92);
    else if (!s.stalled) this.availScale = Math.min(1, this.availScale + 0.01 * dt);
    this.wasStalled = s.stalled;

    if (this.co) {
      this.modelLaw(ac, rollErr, nDes, world, dt);
    } else {
      // ---- roll (generic PD) -------------------------------------------
      c.roll = clamp(k.rollKp * rollErr + k.rollKd * clamp(dRoll, -6, 6), -1, 1);

      // ---- pitch: PI on g-load with feed-forward -------------------------
      const gErr = nDes - s.gLoad;
      const ff = k.gFeedForward * (nDes - 1);
      let pitch = ff + k.gKp * gErr + this.gI;
      const saturated = (pitch > 1 && gErr > 0) || (pitch < -1 && gErr < 0);
      const nearStall = s.stalled || s.aoa > stallAoa * 0.8;
      if (nearStall) this.gI = Math.min(this.gI, 0) - 0.5 * dt;
      else if (!saturated) this.gI = clamp(this.gI + k.gKi * gErr * dt, -0.6, 0.6);
      pitch = ff + k.gKp * gErr + this.gI;
      c.pitch = clamp(pitch, -1, 1);
    }

    // ---- yaw: null sideslip ----------------------------------------------
    const vb = _vb.copy(s.velocity).applyQuaternion(_qInv.copy(q).invert());
    const beta = Math.atan2(vb.x, -vb.z);
    if (V > 5) yaw += k.slipK * beta;
    c.yaw = clamp(yaw, -1, 1);

    // ---- throttle --------------------------------------------------------
    if (!this.recovering) {
      if (ground.emergency || cmd.speed === Infinity) {
        c.throttle = 1;
        this.thrI = clamp(this.thrI, -0.2, 0.4);
      } else if (cmd.speed <= 0) {
        c.throttle = 0;
      } else {
        const ev = cmd.speed - V;
        const t = 0.65 + this.thrI + k.speedKp * ev;
        if (!((t > 1 && ev > 0) || (t < 0 && ev < 0))) this.thrI = clamp(this.thrI + k.speedKi * ev * dt, -0.65, 0.35);
        c.throttle = clamp(0.65 + this.thrI + k.speedKp * ev, 0, 1);
      }
    }
    // Energy discipline: never idle below the speed floor (a range-hold behind a slow
    // target otherwise bleeds a scout into a stall), and keep more speed near the ground,
    // where there is no height to recover from one. Power-off landings are exempt.
    if (cmd.speed !== 0 && !s.onGround && !cmd.landing) {
      const lowFactor = s.heightAboveGround < minAgl * 2 ? 1.65 : 1.4;
      const floor = Math.max(cmd.minSpeed ?? 0, this.traits.stallSpeed * lowFactor);
      if (V < floor * 1.1) c.throttle = Math.max(c.throttle, clamp((floor * 1.1 - V) / (0.1 * floor), 0.5, 1));
    }
    // Throttle back in a fast dive (before the governor bites).
    if (!ground.emergency && s.velocity.y < 0) {
      const thrCap = clamp((govStart + 0.02 - vr) / 0.12, 0, 1);
      if (c.throttle > thrCap) c.throttle = thrCap;
    }
  }

  /**
   * Terrain protection. Returns a minimum climb component for the desired
   * direction, and an emergency flag for an immediate wings-level pull-up.
   *
   * The emergency test uses a dive-recovery model: altitude lost pulling out
   * of the current dive at the g we can use, plus roll-out/reaction time,
   * compared against height over the highest terrain just ahead.
   */
  private groundCheck(ac: AircraftEntity, world: WorldQuery, minAgl: number, lowLevel: boolean, nPull: number): { climb: number; emergency: boolean } {
    const s = ac.state;
    if (s.onGround) return { climb: 0, emergency: false };
    const margin = lowLevel ? Math.min(minAgl, 25) : minAgl;
    const V = Math.max(1, s.velocity.length());
    let worst = Infinity;
    let groundAhead = world.groundHeightAt(s.position.x, s.position.z);
    // Strafing/landing deliberately point at the ground: only look a short way ahead.
    const horizon = lowLevel ? 2.5 : 6;
    for (const t of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
      if (t > horizon) break;
      _p.copy(s.position).addScaledVector(s.velocity, t);
      const gh = world.groundHeightAt(_p.x, _p.z);
      if (t <= 3) {
        // Terrain under the horizontal track (rising ground ahead).
        const hx = s.position.x + s.velocity.x * t;
        const hz = s.position.z + s.velocity.z * t;
        groundAhead = Math.max(groundAhead, world.groundHeightAt(hx, hz));
      }
      const clearance = _p.y - gh;
      const need = margin * Math.min(1, 0.4 + t / 5);
      if (need - clearance > 0 && clearance < worst) worst = clearance;
    }
    const hEff = s.position.y - groundAhead;
    const sinDive = clamp(-s.velocity.y / V, -1, 1);
    let loss = 0;
    if (sinDive > 0) {
      // Before pulling, the lift vector must be rolled into the vertical plane: an aircraft
      // banked steeply (or inverted) in a dive spends ~1-1.5 s rolling at ~1 g, sinking and
      // accelerating. Estimate that time from the roll angle and the available roll rate.
      const vhat = _gcV.copy(s.velocity).divideScalar(V);
      const upPerp = _gcUp.set(0, 1, 0).addScaledVector(vhat, -vhat.y);
      let rollOut = 0;
      if (upPerp.lengthSq() > 0.02) {
        const rr = _gcR.set(1, 0, 0).applyQuaternion(s.orientation);
        const uu = _gcU.set(0, 1, 0).applyQuaternion(s.orientation);
        rollOut = Math.abs(Math.atan2(upPerp.dot(rr), upPerp.dot(uu)));
      }
      const rollRate = this.co ? Math.min(3, (this.co.rollAuthority / (2 * this.co.rollDamping)) * V) : 2;
      const tRoll = 0.35 + rollOut / Math.max(0.8, rollRate);
      const sink = -s.velocity.y;
      const vAfter = V + G * sinDive * tRoll;
      // The pitch law lags in a sustained pull: plan on ~85% of the usable g.
      const n = Math.max(1.5, nPull * 0.85);
      const radius = (vAfter * vAfter) / ((n - 1) * G);
      const cosDive = Math.sqrt(1 - sinDive * sinDive);
      loss = radius * (1 - cosDive) + sink * tRoll + 0.5 * G * sinDive * sinDive * tRoll * tRoll;
    }
    const emergency = sinDive > 0.03 && hEff < loss + margin * 0.3;
    let climb = 0;
    if (worst < Infinity) climb = clamp(0.1 + ((margin - worst) / Math.max(margin, 1)) * 0.5, 0.1, 0.6);
    else if (hEff < margin) climb = clamp(0.25 * (1 - hEff / margin), 0, 0.25);
    return { climb, emergency };
  }
}
