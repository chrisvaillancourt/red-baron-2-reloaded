/**
 * A simple but physically plausible flight model used ONLY for AI tests,
 * so the AI can be developed before the real 6-DOF model (src/sim) exists.
 *
 * - Roll: rate-limited, first-order response to the roll stick.
 * - Pitch: the stick commands load factor (n = 1 + 4*pitch), limited by the
 *   lift available at the current speed; exceeding it stalls the wing.
 * - Velocity: thrust (power/speed, static-limited), parasite + induced drag,
 *   lift along body-up, gravity. The nose follows the flight path.
 * - Rudder: slow flat skid + sideslip readout.
 * Honours the ControlInputs sign conventions of src/core/types.ts.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity, AircraftSpec, FlightEnvironment } from '../../core/types';
import { clamp, G } from '../math';

export interface PointMassParams {
  mass: number;
  wingArea: number;
  powerW: number;
  cd0: number;
  inducedK: number;
  clMax: number;
  maxRollRate: number; // rad/s
  propEta: number;
}

const ISA_RHO0 = 1.225;
export function isaDensity(alt: number): number {
  const T = 288.15 - 0.0065 * Math.min(alt, 11000);
  return ISA_RHO0 * Math.pow(T / 288.15, 4.256);
}

export function paramsFor(spec: AircraftSpec): PointMassParams {
  const p = spec.performance;
  const powerW = p.enginePowerHp * 745.7;
  const clMax = spec.geometry.layout === 'triplane' ? 1.45 : 1.25;
  const ar = (spec.geometry.span * spec.geometry.span) / p.wingArea;
  const inducedK = 1 / (Math.PI * Math.max(ar, 3) * 0.7);
  const vmax = p.maxSpeedKmh / 3.6;
  const rho = isaDensity(p.maxSpeedAltM);
  const eta = 0.75;
  const q = 0.5 * rho * vmax * vmax;
  const cl = (p.massLoaded * G) / (q * p.wingArea);
  const thrust = (eta * powerW * powerRatio(rho)) / vmax;
  const cd0 = Math.max(0.01, thrust / (q * p.wingArea) - inducedK * cl * cl);
  return {
    mass: p.massLoaded,
    wingArea: p.wingArea,
    powerW,
    cd0,
    inducedK,
    clMax,
    maxRollRate: (60 + 90 * p.rollRate) * (Math.PI / 180),
    propEta: eta,
  };
}

function powerRatio(rho: number): number {
  return Math.pow(rho / ISA_RHO0, 1.1);
}

const _f = new Vector3();
const _u = new Vector3();
const _a = new Vector3();
const _q = new Quaternion();
const _vn = new Vector3();

/** Deliberate model variations, to check the AI is robust to a flight model it wasn't tuned on. */
export interface ModelVariant {
  /** Load factor per unit of positive stick (default 4). */
  pitchGain?: number;
  /** Stick offset needed for 1 g (a trim error the AI must integrate out). */
  pitchTrim?: number;
  /** Roll rate multiplier (default 1). */
  rollGain?: number;
  /** Roll response lag rate, 1/s (default 6). */
  rollLag?: number;
}

export class PointMassModel {
  private rollRate = 0;
  readonly p: PointMassParams;

  constructor(spec: AircraftSpec, private readonly variant: ModelVariant = {}) {
    this.p = paramsFor(spec);
  }

  step(ac: AircraftEntity, env: FlightEnvironment, dt: number): void {
    const s = ac.state;
    const c = ac.controls;
    const p = this.p;
    if (ac.outcome) return;
    const q = s.orientation;
    if (s.onGround) {
      // Rollout: friction + drag, no lift-off modelled.
      const v = s.velocity.length();
      const decel = 1.2 + (0.5 * isaDensity(s.position.y) * v * v * p.wingArea * p.cd0 * 3) / p.mass;
      const nv = Math.max(0, v - decel * dt);
      s.velocity.setY(0).setLength(nv);
      s.position.addScaledVector(s.velocity, dt);
      s.position.y = env.groundHeightAt(s.position.x, s.position.z);
      s.airspeed = nv;
      s.heightAboveGround = 0;
      s.gLoad = 1;
      return;
    }
    const f = _f.set(0, 0, -1).applyQuaternion(q);
    let V = s.velocity.length();
    if (V < 1) {
      s.velocity.copy(f).multiplyScalar(1);
      V = 1;
    }
    const rho = isaDensity(s.position.y);
    const dyn = 0.5 * rho * V * V;

    // Roll
    const vr = this.variant;
    const targetRoll = clamp(c.roll, -1, 1) * p.maxRollRate * (vr.rollGain ?? 1) * clamp(dyn / 800, 0.2, 1);
    this.rollRate += (targetRoll - this.rollRate) * Math.min(1, dt * (vr.rollLag ?? 6));
    _q.setFromAxisAngle(f, this.rollRate * dt);
    q.premultiply(_q);

    // Load factor
    const nAvail = (dyn * p.wingArea * p.clMax) / (p.mass * G);
    const stick = clamp(c.pitch - (vr.pitchTrim ?? 0), -1, 1);
    let n = 1 + stick * (stick > 0 ? (vr.pitchGain ?? 4) : 2.5);
    s.stalled = false;
    if (n > nAvail) {
      s.stalled = true;
      n = nAvail * 0.6;
    } else if (n < -0.5 * nAvail) {
      s.stalled = true;
      n = -0.3 * nAvail;
    }
    const cl = (n * p.mass * G) / Math.max(dyn * p.wingArea, 1);
    const drag = dyn * p.wingArea * (p.cd0 + p.inducedK * cl * cl);
    const power = p.powerW * clamp(c.throttle, 0, 1) * powerRatio(rho) * (ac.damage.engineDead ? 0 : 1);
    const thrust = Math.min((p.propEta * power) / Math.max(V, 1), (power / 745.7) * 3.2 * G * 0.7);

    const u = _u.set(0, 1, 0).applyQuaternion(q);
    const a = _a.set(0, -G, 0);
    a.addScaledVector(f, (thrust - drag) / p.mass);
    a.addScaledVector(u, n * G);
    const oldDir = _vn.copy(s.velocity).normalize();
    s.velocity.addScaledVector(a, dt);

    // Rudder: flat skid of the flight path.
    const yawRate = clamp(c.yaw, -1, 1) * 0.35 * clamp(dyn / 1500, 0.2, 1);
    _q.setFromAxisAngle(u, -yawRate * dt);
    s.velocity.applyQuaternion(_q);
    q.premultiply(_q);

    // Nose follows the flight path (minimal rotation keeps bank).
    const newDir = s.velocity.clone().normalize();
    _q.setFromUnitVectors(oldDir, newDir);
    q.premultiply(_q).normalize();

    s.position.addScaledVector(s.velocity, dt);
    V = s.velocity.length();
    s.airspeed = V;
    s.altitude = s.position.y;
    const gh = env.groundHeightAt(s.position.x, s.position.z);
    s.heightAboveGround = s.position.y - gh;
    s.gLoad = n;
    s.aoa = s.stalled ? 0.3 : (Math.max(n, 0) / Math.max(nAvail, 0.1)) * 0.26;
    s.sideslip = c.yaw * 0.05;
    s.engineRpm = 600 + 800 * c.throttle;
    s.angularVelocity.set(0, yawRate, this.rollRate);
    if (s.heightAboveGround <= 0) {
      s.position.y = gh;
      s.onGround = true;
      const bank = Math.atan2(-new Vector3(1, 0, 0).applyQuaternion(q).y, u.y);
      const gentle = s.velocity.y > -3.5 && Math.abs(bank) < 20 * (Math.PI / 180) && V < 45;
      if (gentle) {
        s.velocity.y = 0;
        // Level the attitude on the wheels.
        const h = Math.atan2(s.velocity.x, -s.velocity.z);
        q.setFromAxisAngle(new Vector3(0, 1, 0), -h);
      } else {
        ac.outcome = 'crashed';
      }
    }
  }
}
