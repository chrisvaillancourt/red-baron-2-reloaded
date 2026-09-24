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
import { angleBetween, clamp, G, headingOf, WORLD_UP, wrapPi } from './math';
import type { AircraftTraits } from './traits';

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
const _qInv = new Quaternion();

export class Autopilot {
  gains: AutopilotGains;
  /** Debug/telemetry. */
  recovering = false;
  groundEmergency = false;
  lastNDes = 1;

  private gI = 0;
  private thrI = 0;
  private prevTheta = 0;
  private prevRollErr = 0;
  private rollSign = 1;
  private prevHeading = 0;
  private first = true;
  /** Learned fraction of the estimated available g actually usable before stalling. */
  availScale = 1;
  private wasStalled = false;

  constructor(
    private readonly traits: AircraftTraits,
    private readonly defaultMaxG: number,
    private readonly defaultMinAgl: number,
    rollRate: number,
    pitchRate: number,
  ) {
    this.gains = defaultGains(rollRate, pitchRate);
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
    const headingRate = wrapPi(heading - this.prevHeading) / Math.max(dt, 1e-3);
    this.prevHeading = heading;

    c.blip = false;
    if (s.onGround && cmd.speed === 0) {
      c.pitch = 0.3;
      c.roll = 0;
      c.yaw = 0;
      c.throttle = 0;
      return;
    }

    const bank = Math.atan2(-r.y, u.y);
    const maxG = cmd.maxG ?? this.defaultMaxG;
    // Available g before the wing stalls, from the speed/stall-speed ratio.
    const rhoRatio = world.env.airDensityAt(s.position.y) / 1.225;
    const nAvail = Math.max(0.5, (V / this.traits.stallSpeed) ** 2 * rhoRatio);

    // ---- desired direction, with ground avoidance ------------------------
    const d = _d.copy(cmd.dir);
    if (d.lengthSq() < 1e-9) d.copy(vhat);
    d.normalize();
    const minAgl = cmd.minAgl ?? this.defaultMinAgl;
    const ground = this.groundCheck(ac, world, minAgl, cmd.lowLevel === true);
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
    if (ground.climb > 0 && d.y < ground.climb) {
      d.y = ground.climb;
      d.normalize();
    }

    // ---- stall recovery --------------------------------------------------
    const stallish = s.stalled || (V < this.traits.stallSpeed * 0.92 && !s.onGround);
    if (stallish && !this.recovering) this.recovering = true;
    if (this.recovering && !s.stalled && V > this.traits.stallSpeed * 1.35) this.recovering = false;

    let rollErr: number;
    let nDes: number;
    let yaw = 0;

    if (this.recovering) {
      rollErr = -bank;
      nDes = s.stalled ? 0.3 : 0.7;
      if (Math.abs(headingRate) > 0.6) yaw = -Math.sign(headingRate);
      c.throttle = 1;
    } else if (ground.emergency) {
      rollErr = -bank;
      nDes = Math.min(maxG, nAvail * 0.9);
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
      const omega = clamp(k.turnKp * aggr * theta + k.turnKd * Math.min(0, dTheta), 0, omegaMax);
      const gComp = _g.copy(WORLD_UP).addScaledVector(ref, -WORLD_UP.dot(ref)).multiplyScalar(G);
      // Don't ask for more turn than the wing can give on top of carrying our weight,
      // otherwise the bank overshoots and the nose drops in every turn.
      const nLim = Math.min(maxG, nAvail * 0.92 * this.availScale) * G;
      const b = perp.dot(gComp);
      const disc = b * b - (gComp.lengthSq() - nLim * nLim);
      const aLatMax = disc > 0 ? Math.max(0, -b + Math.sqrt(disc)) : 0;
      const a = _a.copy(perp).multiplyScalar(Math.min(omega * V, Math.max(aLatMax, 0.3 * G)));
      a.add(gComp);
      const ax = a.dot(r);
      const ay = a.dot(u);
      const mag = Math.hypot(ax, ay);
      if (mag < 0.35 * G) {
        rollErr = -bank;
        nDes = ay / G;
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
    nDes = Math.min(nDes, maxG, nAvail * 0.92 * this.availScale);
    if (V > this.traits.maxSafeDiveSpeed) nDes = Math.min(nDes, 3);
    nDes = Math.max(nDes, -1.5);
    this.lastNDes = nDes;

    // ---- roll -----------------------------------------------------------
    const dRoll = wrapPi(rollErr - this.prevRollErr) / Math.max(dt, 1e-3);
    this.prevRollErr = rollErr;
    c.roll = clamp(k.rollKp * rollErr + k.rollKd * clamp(dRoll, -6, 6), -1, 1);

    // ---- pitch: PI on g-load with feed-forward ---------------------------
    const gErr = nDes - s.gLoad;
    const ff = k.gFeedForward * (nDes - 1);
    let pitch = ff + k.gKp * gErr + this.gI;
    const saturated = (pitch > 1 && gErr > 0) || (pitch < -1 && gErr < 0);
    const nearStall = s.stalled || s.aoa > stallAoa * 0.8;
    if (nearStall) this.gI = Math.min(this.gI, 0) - 0.5 * dt;
    else if (!saturated) this.gI = clamp(this.gI + k.gKi * gErr * dt, -0.6, 0.6);
    // Adapt to the real stall boundary: each fresh stall trims the usable g.
    if (s.stalled && !this.wasStalled) this.availScale = Math.max(0.55, this.availScale * 0.92);
    else if (!s.stalled) this.availScale = Math.min(1, this.availScale + 0.01 * dt);
    this.wasStalled = s.stalled;
    pitch = ff + k.gKp * gErr + this.gI;
    c.pitch = clamp(pitch, -1, 1);

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
  }

  /**
   * Look ahead along the velocity vector. Returns a minimum climb component
   * for the desired direction, and an emergency flag for an immediate pull-up.
   */
  private groundCheck(ac: AircraftEntity, world: WorldQuery, minAgl: number, lowLevel: boolean): { climb: number; emergency: boolean } {
    const s = ac.state;
    if (s.onGround) return { climb: 0, emergency: false };
    const margin = lowLevel ? Math.min(minAgl, 25) : minAgl;
    const hNow = s.position.y - world.groundHeightAt(s.position.x, s.position.z);
    let worst = Infinity;
    let worstT = 0;
    for (const t of [0.5, 1, 1.5, 2, 3, 4, 5, 6]) {
      _p.copy(s.position).addScaledVector(s.velocity, t);
      const clearance = _p.y - world.groundHeightAt(_p.x, _p.z);
      const need = margin * Math.min(1, 0.4 + t / 5);
      const deficit = need - clearance;
      if (deficit > 0 && clearance < worst) {
        worst = clearance;
        worstT = t;
      }
    }
    const descending = s.velocity.y < -1;
    // Emergency: predicted to be within a few metres of the ground within ~2.5 s.
    const emergency = worst < Math.max(8, margin * 0.25) && worstT <= 2.5 && descending;
    let climb = 0;
    if (worst < Infinity) climb = clamp(0.1 + (margin - worst) / Math.max(margin, 1) * 0.5, 0.1, 0.6);
    else if (hNow < margin) climb = clamp(0.25 * (1 - hNow / margin), 0, 0.25);
    return { climb, emergency };
  }
}
