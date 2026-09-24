/**
 * 6-DOF rigid-body flight model.
 *
 * Forces are computed from a lumped wing polar (coefficients.ts) in the body
 * frame; moments use an "acceleration form" (stiffness/damping/authority per
 * unit dynamic pressure, derived per type) so handling stays predictable while
 * keeping the physical couplings that matter for WWI aircraft: static
 * stability, stall/spin, dihedral, adverse yaw, rotary torque and gyroscopic
 * precession, damage asymmetry, and taildragger ground handling.
 *
 * Body frame: forward -Z, up +Y, right +X. angularVelocity is the physical
 * body-frame vector (right-hand rule): +x = nose up, +y = nose LEFT,
 * +z = roll LEFT. Internally the model works in pilot rates
 * q = pitch up, r = yaw right, p = roll right.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity, AircraftSpec, FlightEnvironment, FlightState, RealismSettings } from '../core/types';
import {
  dragCoefficient,
  getCoefficients,
  liftCoefficient,
  powerAtAltitude,
  propThrust,
  type FlightCoefficients,
} from './coefficients';

const DEG = Math.PI / 180;
export const SIM_DT = 1 / 120;

export type FailedPart = 'leftWing' | 'rightWing' | 'tail';

/** Per-aircraft hidden sim state (engine lag, timers). Read-only for other modules. */
export interface SimInternal {
  powerFrac: number;
  time: number;
  seed: number;
  overstress: number;
  failedPart: FailedPart | null;
  /** Aircraft has hit the ground after crashing / being shot down: frozen. */
  impacted: boolean;
  /** What happened at ground contact ('crashed', 'ditched', 'impact'). */
  impactKind: 'crashed' | 'ditched' | 'impact' | null;
  wasStalled: boolean;
  spinning: boolean;
}

const internals = new WeakMap<AircraftEntity, SimInternal>();

export function getSimInternal(ac: AircraftEntity): SimInternal {
  let it = internals.get(ac);
  if (!it) {
    it = {
      powerFrac: ac.state.onGround ? 0 : ac.controls.throttle,
      time: 0,
      seed: (ac.id * 2654435761) >>> 0,
      overstress: 0,
      failedPart: null,
      impacted: false,
      impactKind: null,
      wasStalled: false,
      spinning: false,
    };
    internals.set(ac, it);
  }
  return it;
}

// Scratch objects (no allocation in the step loop).
const _wind = new Vector3();
const _vAir = new Vector3();
const _vb = new Vector3();
const _qInv = new Quaternion();
const _fBody = new Vector3();
const _fWorld = new Vector3();
const _liftDir = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _p = new Vector3();
const _vp = new Vector3();
const _torque = new Vector3();
const _dq = new Quaternion();
const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();

interface ContactPoint {
  r: Vector3;
  kind: 'wheel' | 'skid' | 'hard';
}

const contactCache = new WeakMap<FlightCoefficients, ContactPoint[]>();

function contactPoints(co: FlightCoefficients, spec: AircraftSpec): ContactPoint[] {
  let pts = contactCache.get(co);
  if (pts) return pts;
  const g = co.gear;
  const geo = spec.geometry;
  const lowY = geo.layout === 'monoplane' ? -0.15 : geo.layout === 'parasol' ? 0.7 : -0.4;
  const lowSpan = geo.lowerSpan > 0 ? geo.lowerSpan : geo.span;
  pts = [
    { r: new Vector3(-g.halfTrack, g.mainY, g.mainZ), kind: 'wheel' },
    { r: new Vector3(g.halfTrack, g.mainY, g.mainZ), kind: 'wheel' },
    { r: new Vector3(0, g.tailY, g.tailZ), kind: 'skid' },
    { r: new Vector3(-lowSpan / 2, lowY, 0), kind: 'hard' },
    { r: new Vector3(lowSpan / 2, lowY, 0), kind: 'hard' },
    { r: new Vector3(0, -0.2, -0.36 * geo.length), kind: 'hard' },
    { r: new Vector3(0, Math.max(1.0, geo.gap + lowY), 0), kind: 'hard' },
    { r: new Vector3(-geo.span / 2, lowY + Math.max(geo.gap, 0.3), 0), kind: 'hard' },
    { r: new Vector3(geo.span / 2, lowY + Math.max(geo.gap, 0.3), 0), kind: 'hard' },
    { r: new Vector3(0, 1.1, 0.6 * geo.length), kind: 'hard' },
  ];
  contactCache.set(co, pts);
  return pts;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Deterministic smooth noise in [-1, 1] from time and a per-aircraft seed. */
function wobble(t: number, seed: number, k: number): number {
  const s = (seed % 1000) * 0.013 + k * 1.7;
  return Math.sin(t * (0.9 + k * 0.37) + s) * 0.6 + Math.sin(t * (2.3 + k * 0.51) + s * 2.1) * 0.4;
}

export function bankAngle(q: Quaternion): number {
  _right.set(1, 0, 0).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  return Math.atan2(-_right.y, _up.y);
}

export function pitchAngle(q: Quaternion): number {
  _fwd.set(0, 0, -1).applyQuaternion(q);
  return Math.asin(clamp(_fwd.y, -1, 1));
}

/** Heading (rad, 0 = north, clockwise) of the body's forward axis. */
export function headingOf(q: Quaternion): number {
  _fwd.set(0, 0, -1).applyQuaternion(q);
  const h = Math.atan2(_fwd.x, -_fwd.z);
  return h < 0 ? h + Math.PI * 2 : h;
}

/** Orientation for a given heading (rad, clockwise from north), pitch and bank (rad, right-wing-down positive). */
export function orientationFrom(heading: number, pitch: number, bank = 0, out = new Quaternion()): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -heading);
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -bank);
  return out.copy(qy).multiply(qx).multiply(qz);
}

/** Map a desired angle of attack to the stick position that commands it (inverse of the pitch law). */
export function stickForAlpha(co: FlightCoefficients, alpha: number): number {
  if (alpha >= co.alphaTrim) return clamp((alpha - co.alphaTrim) / (co.alphaCmdMax - co.alphaTrim), 0, 1);
  return -clamp((co.alphaTrim - alpha) / (co.alphaTrim - co.alphaCmdMin), 0, 1);
}

export function createFlightState(
  spec: AircraftSpec,
  start: { x: number; z: number; altitude: number; heading: number; airspeed: number },
  env: FlightEnvironment,
  onGround: boolean,
): FlightState {
  const co = getCoefficients(spec);
  const ground = env.groundHeightAt(start.x, start.z);
  const orientation = new Quaternion();
  const position = new Vector3();
  const velocity = new Vector3();
  let rpm: number;
  if (onGround) {
    orientationFrom(start.heading, co.gear.groundPitch, 0, orientation);
    position.set(start.x, ground + co.gear.cgHeight + 0.02, start.z);
    rpm = co.rpmIdle;
  } else {
    const alt = Math.max(start.altitude, ground + 50);
    const v = Math.max(start.airspeed, co.vStallSL * 1.3);
    const rho = env.airDensityAt(alt);
    const cl = co.weight / (0.5 * rho * v * v * co.wingArea);
    const alpha = cl / co.clAlpha + co.alpha0;
    orientationFrom(start.heading, alpha, 0, orientation);
    position.set(start.x, alt, start.z);
    velocity.set(Math.sin(start.heading) * v, 0, -Math.cos(start.heading) * v);
    rpm = co.rpmMax * 0.85;
  }
  return {
    position,
    velocity,
    orientation,
    angularVelocity: new Vector3(),
    airspeed: velocity.length(),
    altitude: position.y,
    heightAboveGround: position.y - ground,
    aoa: 0,
    sideslip: 0,
    gLoad: 1,
    engineRpm: rpm,
    fuelL: spec.performance.fuelCapacityL,
    onGround,
    stalled: false,
  };
}

/** Advance one aircraft by dt (sub-stepped internally to <= 1/120 s). */
export function stepFlight(ac: AircraftEntity, env: FlightEnvironment, realism: RealismSettings, dt: number): void {
  if (dt <= 0) return;
  const n = Math.max(1, Math.ceil(dt / SIM_DT - 1e-6));
  const h = dt / n;
  for (let i = 0; i < n; i++) stepOnce(ac, env, realism, h);
}

function stepOnce(ac: AircraftEntity, env: FlightEnvironment, realism: RealismSettings, dt: number): void {
  const s = ac.state;
  const co = getCoefficients(ac.spec);
  const it = getSimInternal(ac);
  const dmg = ac.damage;
  const z = dmg.zones;
  it.time += dt;

  if (it.impacted) {
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.onGround = true;
    s.airspeed = 0;
    s.engineRpm = Math.max(0, s.engineRpm - 600 * dt);
    return;
  }

  const level = realism.flightModel;
  const relaxed = level === 'relaxed';
  const authentic = level === 'authentic';

  // ---------------------------------------------------------------- inputs
  const c = ac.controls;
  let pitchIn = clamp(c.pitch, -1, 1);
  let rollIn = clamp(c.roll, -1, 1);
  let yawIn = clamp(c.yaw, -1, 1);
  let throttle = clamp(c.throttle, 0, 1);
  const outOfControl = dmg.pilotKilled || dmg.structuralFailure || (dmg.destroyed && ac.outcome !== null);
  if (outOfControl) {
    const t = it.time;
    pitchIn = -0.25 + 0.35 * wobble(t, it.seed, 1);
    rollIn = 0.5 * wobble(t, it.seed, 2) + (it.seed & 1 ? 0.3 : -0.3);
    yawIn = 0.4 * wobble(t, it.seed, 3);
    if (dmg.pilotKilled) throttle = c.throttle;
  } else if (dmg.pilotWounded) {
    const t = it.time;
    pitchIn = clamp(pitchIn * 0.85 + 0.06 * wobble(t, it.seed, 4), -1, 1);
    rollIn = clamp(rollIn * 0.85 + 0.06 * wobble(t, it.seed, 5), -1, 1);
  }

  // -------------------------------------------------------------- air data
  env.windAt(s.position, _wind);
  _vAir.copy(s.velocity).sub(_wind);
  _qInv.copy(s.orientation).invert();
  _vb.copy(_vAir).applyQuaternion(_qInv);
  const V = _vb.length();
  const alpha = V > 0.5 ? Math.atan2(-_vb.y, -_vb.z) : 0;
  const beta = V > 0.5 ? Math.asin(clamp(_vb.x / V, -1, 1)) : 0;
  const rho = env.airDensityAt(s.position.y);
  const qd = 0.5 * rho * V * V;
  const uFwd = Math.max(0, -_vb.z);

  // Rates in pilot convention.
  const qRate = s.angularVelocity.x;
  const rRate = -s.angularVelocity.y;
  const pRate = -s.angularVelocity.z;

  // ---------------------------------------------------------------- engine
  const engineAlive = !dmg.engineDead && z.engine < 1 && (s.fuelL > 0 || !realism.limitedFuel);
  let target = engineAlive ? throttle : 0;
  const blipping = c.blip && co.isRotary;
  if (blipping) target = 0;
  if (blipping) it.powerFrac = Math.min(it.powerFrac, 0.03);
  it.powerFrac += (target - it.powerFrac) * Math.min(1, dt / co.engineLag);
  let health = 1 - 0.75 * z.engine;
  if (z.engine > 0.5) health *= 0.65 + 0.35 * (0.5 + 0.5 * wobble(it.time * 6, it.seed, 6));
  const shaftPower = powerAtAltitude(co, s.position.y) * it.powerFrac * health;
  const thrust = propThrust(co, shaftPower, uFwd);
  const windmillDrag = qd * co.propDiscArea * 0.05 * (1 - it.powerFrac);
  const rpmTarget =
    engineAlive && !blipping
      ? co.rpmIdle + (co.rpmMax - co.rpmIdle) * Math.sqrt(it.powerFrac) * (0.9 + 0.1 * Math.min(1.3, V / co.vMax))
      : co.rpmMax * 0.35 * Math.min(1.3, V / co.vMax);
  s.engineRpm += (rpmTarget - s.engineRpm) * Math.min(1, dt / 0.7);
  if (realism.limitedFuel) {
    s.fuelL = Math.max(0, s.fuelL - co.fuelBurnFull * (0.25 + 0.75 * it.powerFrac) * dt - (dmg.fuelLeak ? 0.12 * dt : 0));
  }

  // ------------------------------------------------------------ aero forces
  const dL = it.failedPart === 'leftWing' ? 1 : z.leftWing;
  const dR = it.failedPart === 'rightWing' ? 1 : z.rightWing;
  const wingFactor = 1 - 0.3 * (dL + dR) - (it.failedPart === 'leftWing' || it.failedPart === 'rightWing' ? 0.25 : 0);
  const cl = liftCoefficient(co, alpha) * wingFactor;
  const cd = dragCoefficient(co, cl, alpha) + 0.03 * (dL + dR) + 0.02 * z.fuselage + 0.4 * Math.sin(beta) ** 2;
  const qS = qd * co.wingArea;
  _fBody.set(0, 0, 0);
  if (V > 0.5) {
    const dx = _vb.x / V;
    const dy = _vb.y / V;
    const dz = _vb.z / V;
    _liftDir.set(0, -dz, dy);
    const ll = _liftDir.length();
    if (ll > 1e-6) _liftDir.multiplyScalar(1 / ll);
    _fBody.addScaledVector(_liftDir, qS * cl);
    _fBody.x -= dx * (qS * cd + windmillDrag);
    _fBody.y -= dy * (qS * cd + windmillDrag);
    _fBody.z -= dz * (qS * cd + windmillDrag);
    _fBody.x += -co.sideForceCoef * clamp(beta, -0.6, 0.6) * qS;
  }
  _fBody.z -= thrust;
  // Normal load factor (aero + thrust along body up), before ground forces.
  const gLoad = _fBody.y / co.weight;

  // World-frame force accumulator.
  _fWorld.copy(_fBody).applyQuaternion(s.orientation);
  _fWorld.y -= co.weight;

  // ------------------------------------------------------------- moments
  const stallFactor = clamp((alpha - co.alphaStall) / (4 * DEG), 0, 1);
  const stalled = stallFactor > 0.15;
  const controlEff = (1 - 0.7 * z.controls) * (1 - 0.5 * z.tail) * (outOfControl ? 0.6 : 1);
  const dampMul = relaxed ? 1.5 : 1;
  const vDamp = Math.max(V, 6);

  // Slipstream over the tail gives pitch/yaw authority on the ground.
  const qSlip = Math.min(2500, (thrust / co.propDiscArea) * 0.6);
  const qTail = qd + qSlip;
  const alphaTail = qTail > 1 ? (qd * alpha) / qTail : 0;

  // Pitch law: stick commands an angle of attack about the hands-off trim.
  let alphaCmd =
    pitchIn >= 0 ? co.alphaTrim + pitchIn * (co.alphaCmdMax - co.alphaTrim) : co.alphaTrim + -pitchIn * (co.alphaCmdMin - co.alphaTrim);
  alphaCmd = co.alphaTrim + (alphaCmd - co.alphaTrim) * controlEff;
  if (qS > 50) {
    const gCap = relaxed ? Math.min(5.5, co.gLimit * 0.8) : level === 'standard' ? co.gLimit * 1.08 : Infinity;
    if (Number.isFinite(gCap)) alphaCmd = Math.min(alphaCmd, co.alpha0 + (gCap * co.weight) / qS / co.clAlpha);
  }
  if (relaxed) alphaCmd = Math.min(alphaCmd, co.alphaStall - 1.5 * DEG);
  alphaCmd -= co.stallSharpness * stallFactor * 3 * DEG; // nose drops at the break

  // Spin autorotation (not in relaxed): drives roll+yaw in the direction of yaw while stalled.
  const spinGain = relaxed ? 0 : authentic ? 1.0 : 0.3;
  const spinDir = rRate >= 0 ? 1 : -1;
  const spinDrive = spinGain * stallFactor * clamp(Math.abs(rRate) / 0.35, 0, 1);
  it.spinning = spinDrive > 0.4 && Math.abs(rRate) > 0.8;

  let pitchStiff = co.pitchStiffness * (1 - 0.5 * spinDrive);
  if (it.failedPart === 'tail') pitchStiff *= 0.05;
  let qDot = pitchStiff * qTail * (alphaCmd - alphaTail) - co.pitchDamping * dampMul * rho * vDamp * qRate;

  const rollEff = controlEff * (1 - 0.6 * stallFactor) * (1 - 0.2 * (dL + dR));
  const asym = (it.failedPart === 'leftWing' || it.failedPart === 'rightWing' ? 0.03 : 0.012) * qd * clamp(cl / co.clMax, -1, 1);
  let pDot =
    co.rollAuthority * qd * rollIn * rollEff -
    co.rollDamping * dampMul * rho * vDamp * pRate -
    co.dihedralEffect * qd * clamp(beta, -0.5, 0.5) -
    (dL - dR) * asym;

  if (realism.autoRudder || relaxed) yawIn = clamp(yawIn + clamp(beta * 5, -0.8, 0.8) + 0.12 * rollIn, -1, 1);
  let rDot =
    co.yawAuthority * qTail * yawIn * controlEff +
    co.weathercock * qd * clamp(beta, -0.6, 0.6) -
    co.yawDamping * dampMul * rho * vDamp * rRate -
    co.adverseYaw * qd * rollIn;

  if (relaxed && Math.abs(rollIn) < 0.05 && !s.onGround) {
    const bank = bankAngle(s.orientation);
    if (Math.abs(bank) < 70 * DEG) pDot += -bank * 1.2 - pRate * 0.8;
  }

  // Stall break: wing drop on entry (sharper for Albatros/Nieuport-type sections).
  if (stalled && !it.wasStalled && !relaxed && !s.onGround) {
    const bias = Math.abs(rRate) > 0.05 ? spinDir : ((it.seed >> 3) & 1 ? 1 : -1);
    s.angularVelocity.z -= bias * co.stallSharpness * 0.6; // roll toward bias (p = -wz)
  }
  it.wasStalled = stalled;
  if (spinDrive > 0) {
    pDot += spinDrive * (spinDir * 2.6 - pRate) * 2.2;
    rDot += spinDrive * (spinDir * 1.3 - rRate) * 1.6;
  }

  // Out-of-control tumbling for structural failure.
  if (dmg.structuralFailure) {
    pDot += 3 * wobble(it.time, it.seed, 7) + (it.failedPart === 'rightWing' ? 4 : it.failedPart === 'leftWing' ? -4 : 0);
    qDot += it.failedPart === 'tail' ? 4 * wobble(it.time, it.seed, 8) - 1.5 : 0;
    rDot += 2 * wobble(it.time, it.seed, 9);
  }

  // Torque and gyroscopic precession.
  if (realism.engineTorque && !relaxed) {
    const omegaEng = Math.max(20, (s.engineRpm * 2 * Math.PI) / 60);
    const torque = shaftPower / omegaEng;
    const h = co.engineInertia * omegaEng;
    // Reaction torque rolls left (engine turns clockwise seen from the cockpit).
    pDot -= (torque / co.inertiaRoll) * (co.isRotary ? 1 : 0.5);
    // Gyroscopic: M = H x w with H along body -Z. (body x: +h*wy, body y: -h*wx)
    qDot += (h * s.angularVelocity.y) / co.inertiaPitch;
    rDot += (h * s.angularVelocity.x) / co.inertiaYaw; // body y accel = -h*wx -> r (=-wy) accel = +h*wx
    // Spiral slipstream / rigging: rotaries want to yaw right under power.
    rDot += (co.isRotary ? 0.3 : 0.08) * it.powerFrac * clamp(qd / 800, 0.3, 1.5);
  }

  // Convert to body angular acceleration.
  let ax = qDot;
  let ay = -rDot;
  let az = -pDot;

  // ------------------------------------------------------- ground contact
  let onGround = false;
  const pts = contactPoints(co, ac.spec);
  const k = 60 * co.mass;
  const cdamp = 8 * co.mass;
  let crash: 'crashed' | 'ditched' | null = null;
  const destroyedFalling = dmg.destroyed || dmg.structuralFailure;
  _fwd.set(0, 0, -1).applyQuaternion(s.orientation);
  for (const cp of pts) {
    _p.copy(cp.r).applyQuaternion(s.orientation).add(s.position);
    const gh = env.groundHeightAt(_p.x, _p.z);
    const pen = gh - _p.y;
    if (pen <= 0) continue;
    // Velocity of the contact point.
    _tmp.copy(s.angularVelocity).cross(cp.r).applyQuaternion(s.orientation);
    _vp.copy(s.velocity).add(_tmp);
    if (gh <= 0.3) {
      crash = 'ditched';
      break;
    }
    if (destroyedFalling) {
      crash = 'crashed';
      break;
    }
    const hSpeed = Math.hypot(_vp.x, _vp.z);
    if (cp.kind === 'hard') {
      if (s.velocity.length() > 9) {
        crash = 'crashed';
        break;
      }
    } else if (cp.kind === 'wheel') {
      const sinkLimit = relaxed ? 7 : authentic ? 3.8 : 4.8;
      if (_vp.y < -sinkLimit || hSpeed > Math.max(48, co.vStallSL * 2.3)) {
        crash = 'crashed';
        break;
      }
    }
    onGround = onGround || cp.kind !== 'hard';
    const fn = Math.max(0, k * pen - cdamp * _vp.y);
    _tmp2.set(0, fn, 0);
    // Friction: wheels roll along heading, resist sideways; skid & hard points drag.
    const fx = _fwd.x;
    const fz = _fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl;
    const hz = fz / fl;
    const vAlong = _vp.x * hx + _vp.z * hz;
    const latx = _vp.x - vAlong * hx;
    const latz = _vp.z - vAlong * hz;
    const latSpeed = Math.hypot(latx, latz);
    const muRoll = cp.kind === 'wheel' ? 0.05 : 0.55;
    const muLat = cp.kind === 'wheel' ? 0.8 : 0.55;
    const fAlong = -muRoll * fn * Math.tanh(vAlong / 0.5);
    _tmp2.x += fAlong * hx;
    _tmp2.z += fAlong * hz;
    if (latSpeed > 1e-4) {
      const fLat = muLat * fn * Math.tanh(latSpeed / 0.3);
      _tmp2.x -= (latx / latSpeed) * fLat;
      _tmp2.z -= (latz / latSpeed) * fLat;
    }
    _fWorld.add(_tmp2);
    // Torque in body frame.
    _tmp2.applyQuaternion(_qInv);
    _torque.copy(cp.r).cross(_tmp2);
    ax += _torque.x / co.inertiaPitch;
    ay += _torque.y / co.inertiaYaw;
    az += _torque.z / co.inertiaRoll;
  }

  if (crash) {
    it.impacted = true;
    it.impactKind = destroyedFalling ? 'impact' : crash;
    if (ac.outcome === null) ac.outcome = crash;
    dmg.destroyed = true;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.onGround = true;
    const gh = env.groundHeightAt(s.position.x, s.position.z);
    s.position.y = Math.max(s.position.y, gh + 0.5);
    s.airspeed = 0;
    s.heightAboveGround = s.position.y - gh;
    return;
  }

  // ---------------------------------------------------- structural limits
  if (!dmg.structuralFailure && !s.onGround) {
    const worst = Math.max(dL, dR);
    const limit = co.gLimit * (1 - 0.5 * worst) * (relaxed ? 1.3 : 1);
    const vne = co.vne * (1 - 0.3 * worst) * (relaxed ? 1.2 : 1);
    const gStress = gLoad >= 0 ? gLoad / limit : -gLoad / (limit * 0.5);
    const vStress = V / vne;
    const stress = Math.max(gStress, vStress);
    if (stress > 1) it.overstress += dt * (stress - 1) * 10 + dt * 0.3;
    else it.overstress = Math.max(0, it.overstress - dt * 0.5);
    if (it.overstress > 1) {
      const r = ((it.seed >>> 5) % 100) / 100;
      const part: FailedPart = vStress > gStress && r < 0.2 ? 'tail' : r < 0.6 ? 'leftWing' : 'rightWing';
      it.failedPart = part;
      dmg.zones[part] = 1;
      dmg.structuralFailure = true;
    }
  }

  // ----------------------------------------------------------- integrate
  const inv = 1 / co.mass;
  s.velocity.addScaledVector(_fWorld, inv * dt);
  s.position.addScaledVector(s.velocity, dt);
  const w = s.angularVelocity;
  w.x = clamp(w.x + ax * dt, -8, 8);
  w.y = clamp(w.y + ay * dt, -8, 8);
  w.z = clamp(w.z + az * dt, -8, 8);
  _dq.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1);
  s.orientation.multiply(_dq).normalize();

  if (!Number.isFinite(s.position.x) || !Number.isFinite(s.velocity.x) || !Number.isFinite(s.orientation.w)) {
    // Defensive reset: should never happen, but never let NaN escape into the scene.
    s.velocity.set(0, 0, -30).applyQuaternion(s.orientation.set(0, 0, 0, 1));
    s.angularVelocity.set(0, 0, 0);
    if (!Number.isFinite(s.position.x)) s.position.set(0, 1000, 0);
  }

  // ------------------------------------------------------------ derived
  const gh = env.groundHeightAt(s.position.x, s.position.z);
  s.airspeed = V;
  s.altitude = s.position.y;
  s.heightAboveGround = s.position.y - gh;
  s.aoa = alpha;
  s.sideslip = beta;
  s.gLoad = onGround ? 1 : gLoad;
  s.onGround = onGround;
  s.stalled = stalled && !onGround;
}

/** True when the aircraft is sitting on its wheels, nearly stopped (landed). */
export function isStoppedOnGround(ac: AircraftEntity): boolean {
  return ac.state.onGround && ac.state.airspeed < 3 && ac.state.velocity.length() < 3 && !getSimInternal(ac).impacted;
}
