/**
 * Per-type flight coefficients derived from AircraftSpec historical data.
 *
 * The aerodynamic model is a lumped-wing polar (CL(alpha) with stall, parabolic
 * drag) plus a propeller-efficiency curve and a power-lapse law. Three free
 * parameters are solved per aircraft so the point-mass performance matches the
 * spec (see docs/sim.md):
 *   - cd0          -> max level speed at maxSpeedAltM
 *   - propDesignV  -> time to climb to 3000 m (shape of prop efficiency vs speed)
 *   - lapseN       -> service ceiling (sigma^n power lapse)
 * The 6-DOF model in flightModel.ts uses the same formulas, so it reproduces
 * the figures when flown at the reported best-climb / max speeds.
 */
import type { AircraftSpec, AircraftId } from '../core/types';
import { G, airDensityAt, RHO0 } from './atmosphere';

const DEG = Math.PI / 180;

export interface GearGeometry {
  /** Main wheel contact points: body-frame y (below CG, negative) and z (ahead of CG, negative). */
  mainY: number;
  mainZ: number;
  halfTrack: number;
  tailY: number;
  tailZ: number;
  /** Three-point ground attitude (nose-up pitch), rad. */
  groundPitch: number;
  /** CG height above ground when sitting three-point. */
  cgHeight: number;
}

export interface FlightCoefficients {
  id: AircraftId;
  mass: number;
  weight: number;
  wingArea: number;
  span: number;
  length: number;
  aspectRatioEff: number;
  /** Induced drag factor k = 1/(pi e AR). */
  kInduced: number;
  cd0: number;
  clAlpha: number;
  alpha0: number;
  clMax: number;
  alphaStall: number;
  /** 0 = gentle (Dr.I, D.VII), 1 = sharp break. */
  stallSharpness: number;
  /** Fraction of CLmax kept just past the stall. */
  postStallCl: number;

  powerW: number;
  lapseN: number;
  etaMax: number;
  propDesignV: number;
  propDiscArea: number;
  isRotary: boolean;
  rpmMax: number;
  rpmIdle: number;
  /** Engine response time constant, s. */
  engineLag: number;
  /** Rotating-mass moment of inertia (engine+prop), kg m^2. */
  engineInertia: number;

  /** Airframe inertias about body x (pitch), y (yaw), z (roll), kg m^2. */
  inertiaPitch: number;
  inertiaYaw: number;
  inertiaRoll: number;

  // Handling (acceleration-form coefficients; see flightModel.ts)
  pitchStiffness: number;
  pitchDamping: number;
  rollAuthority: number;
  rollDamping: number;
  yawAuthority: number;
  weathercock: number;
  yawDamping: number;
  dihedralEffect: number;
  sideForceCoef: number;
  adverseYaw: number;

  alphaTrim: number;
  alphaCmdMax: number;
  alphaCmdMin: number;

  gLimit: number;
  /** Never-exceed speed (true airspeed), m/s. */
  vne: number;
  vMax: number;
  vStallSL: number;
  /** Best-climb true airspeed at sea level, m/s. */
  vBestClimbSL: number;
  /** Fuel burn at full power, litres/s. */
  fuelBurnFull: number;

  gear: GearGeometry;
  /** Achieved point-mass performance after calibration (for docs/tests). */
  predicted: { timeTo3000Min: number; ceilingM: number };
}

// ---------------------------------------------------------------------------
// Shared aero formulas (point-mass calibration and 6-DOF use the same ones)
// ---------------------------------------------------------------------------

/** Lift coefficient vs angle of attack (rad), with stall and post-stall decay. */
export function liftCoefficient(co: FlightCoefficients, alpha: number): number {
  const a = alpha;
  const as = co.alphaStall;
  const asNeg = co.alpha0 - (co.alphaStall - co.alpha0) * 0.8;
  if (a <= as && a >= asNeg) return co.clAlpha * (a - co.alpha0);
  if (a > as) {
    // Break: drop toward postStall over a width set by sharpness, then flat-plate decay.
    const width = (3 + 6 * (1 - co.stallSharpness)) * DEG;
    const over = a - as;
    const post = co.clMax * co.postStallCl;
    if (over < width) {
      const t = over / width;
      return co.clMax + (post - co.clMax) * (t * t * (3 - 2 * t));
    }
    const plate = 1.05 * Math.sin(2 * a);
    const blend = Math.min(1, (over - width) / (25 * DEG));
    return post * (1 - blend) + Math.min(post, plate) * blend;
  }
  // Negative stall (symmetric-ish, less lift available).
  const clMin = co.clAlpha * (asNeg - co.alpha0);
  const over = asNeg - a;
  const width = 5 * DEG;
  if (over < width) return clMin * (1 - 0.3 * (over / width));
  const plate = 1.05 * Math.sin(2 * a);
  const blend = Math.min(1, (over - width) / (25 * DEG));
  return clMin * 0.7 * (1 - blend) + Math.max(clMin * 0.7, plate) * blend;
}

/** Drag coefficient given lift coefficient and alpha. */
export function dragCoefficient(co: FlightCoefficients, cl: number, alpha: number): number {
  let cd = co.cd0 + co.kInduced * cl * cl;
  const over = Math.abs(alpha) - co.alphaStall;
  if (over > 0) {
    const s = Math.sin(Math.min(Math.abs(alpha), Math.PI / 2));
    const s0 = Math.sin(co.alphaStall);
    cd += 1.25 * (s * s - s0 * s0);
  }
  return cd;
}

/** Propeller efficiency vs true airspeed: parabolic rise to etaMax at design speed, slow decay beyond. */
export function propEfficiency(co: FlightCoefficients, v: number): number {
  const x = Math.max(0, v) / co.propDesignV;
  if (x <= 1) return co.etaMax * (2 * x - x * x);
  return co.etaMax * Math.max(0.2, 1 - 0.35 * (x - 1) * (x - 1));
}

/** Thrust (N) from shaft power (W) at airspeed v. Finite static thrust via the efficiency curve. */
export function propThrust(co: FlightCoefficients, powerW: number, v: number): number {
  const vv = Math.max(v, 0.5);
  const x = vv / co.propDesignV;
  if (x <= 1) return (co.etaMax * powerW * (2 - x)) / co.propDesignV; // eta/v closed form, no singularity
  return (propEfficiency(co, vv) * powerW) / vv;
}

/** Full-throttle shaft power at altitude (W). */
export function powerAtAltitude(co: FlightCoefficients, altitudeM: number): number {
  return co.powerW * Math.pow(airDensityAt(altitudeM) / RHO0, co.lapseN);
}

// ---------------------------------------------------------------------------
// Point-mass performance
// ---------------------------------------------------------------------------

function levelDrag(co: FlightCoefficients, v: number, rho: number): number {
  const qS = 0.5 * rho * v * v * co.wingArea;
  const cl = co.weight / qS;
  return qS * dragCoefficient(co, cl, cl / co.clAlpha + co.alpha0);
}

/** Maximum rate of climb (m/s) and the speed achieving it at altitude h. */
export function bestClimb(co: FlightCoefficients, h: number): { roc: number; v: number } {
  const rho = airDensityAt(h);
  const p = powerAtAltitude(co, h);
  const vs = Math.sqrt((2 * co.weight) / (rho * co.wingArea * co.clMax));
  let best = { roc: -Infinity, v: vs * 1.3 };
  const v0 = vs * 1.15;
  const v1 = Math.max(v0 + 1, co.vMax * 1.05);
  for (let i = 0; i <= 40; i++) {
    const v = v0 + ((v1 - v0) * i) / 40;
    const roc = ((propThrust(co, p, v) - levelDrag(co, v, rho)) * v) / co.weight;
    if (roc > best.roc) best = { roc, v };
  }
  return best;
}

export function timeToClimb(co: FlightCoefficients, toM: number): number {
  let t = 0;
  const step = 100;
  for (let h = 0; h < toM; h += step) {
    const roc = bestClimb(co, h + step / 2).roc;
    if (roc <= 0.05) return Infinity;
    t += step / roc;
  }
  return t;
}

/** Service ceiling: altitude where best RoC falls to 0.5 m/s (100 ft/min). */
export function serviceCeiling(co: FlightCoefficients): number {
  let lo = 0;
  let hi = 12_000;
  if (bestClimb(co, lo).roc < 0.5) return 0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bestClimb(co, mid).roc > 0.5) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Level-flight maximum speed at altitude by bisection on thrust = drag. */
export function maxLevelSpeed(co: FlightCoefficients, h: number): number {
  const rho = airDensityAt(h);
  const p = powerAtAltitude(co, h);
  let lo = Math.sqrt((2 * co.weight) / (rho * co.wingArea * co.clMax)) * 1.2;
  let hi = 200;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (propThrust(co, p, mid) > levelDrag(co, mid, rho)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function rpmFor(spec: AircraftSpec): { max: number; idle: number } {
  const n = spec.performance.engineName;
  if (spec.performance.engineType === 'rotary') return { max: /Gnome 9N|Monosoupape/.test(n) ? 1300 : 1250, idle: 400 };
  if (/Hispano|Viper/.test(n)) return { max: 2000, idle: 600 };
  if (/Rolls|Eagle|Falcon|RAF/.test(n)) return { max: 1800, idle: 500 };
  return { max: 1450, idle: 450 };
}

function solveCd0(co: FlightCoefficients, spec: AircraftSpec): number {
  const v = spec.performance.maxSpeedKmh / 3.6;
  const h = spec.performance.maxSpeedAltM;
  const rho = airDensityAt(h);
  const t = propThrust(co, powerAtAltitude(co, h), v);
  const qS = 0.5 * rho * v * v * co.wingArea;
  const cl = co.weight / qS;
  return Math.max(0.018, t / qS - co.kInduced * cl * cl);
}

const cache = new Map<AircraftId, FlightCoefficients>();

export function getCoefficients(spec: AircraftSpec): FlightCoefficients {
  const hit = cache.get(spec.id);
  if (hit) return hit;
  const co = deriveCoefficients(spec);
  cache.set(spec.id, co);
  return co;
}

export function deriveCoefficients(spec: AircraftSpec): FlightCoefficients {
  const p = spec.performance;
  const g = spec.geometry;
  const mass = p.massLoaded;
  const weight = mass * G;
  const vMax = p.maxSpeedKmh / 3.6;

  const layoutFactor = { monoplane: 1.0, parasol: 1.0, biplane: 1.3, sesquiplane: 1.2, triplane: 1.4 }[g.layout];
  const aspectRatioEff = ((g.span * g.span) / p.wingArea) * layoutFactor;
  const e = 0.75;
  const kInduced = 1 / (Math.PI * e * aspectRatioEff);
  const clAlpha = (2 * Math.PI * aspectRatioEff) / (aspectRatioEff + 2.4) * 0.92;
  let clMax = { monoplane: 1.05, parasol: 1.2, biplane: 1.2, sesquiplane: 1.15, triplane: 1.35 }[g.layout];
  let stallSharpness = { monoplane: 0.8, parasol: 0.5, biplane: 0.7, sesquiplane: 0.75, triplane: 0.25 }[g.layout];
  // Fokker's thick cantilever sections (D.VII, D.VIII, Dr.I) had high, benign stalls.
  if (/^fokker_d(vii|viii|ri)$/.test(spec.id)) {
    clMax += 0.12;
    stallSharpness = Math.min(stallSharpness, 0.3);
  }
  const alpha0 = -2 * DEG;
  const alphaStall = alpha0 + clMax / clAlpha;

  const isRotary = p.engineType === 'rotary';
  const rpm = rpmFor(spec);
  const propDiameter = Math.min(2.8, 1.9 + p.enginePowerHp / 400);
  const propDiscArea = (Math.PI * propDiameter * propDiameter) / 4;

  // Inertias from mass distribution heuristics (rotaries concentrate mass in the nose).
  const inertiaPitch = mass * Math.pow(0.24 * g.length, 2);
  const inertiaRoll = mass * Math.pow(0.19 * g.span, 2);
  const inertiaYaw = inertiaPitch + inertiaRoll * 0.6;
  const engineInertia = isRotary ? 20 + p.enginePowerHp * 0.08 : 4 + p.enginePowerHp * 0.01;

  // --- Handling in acceleration form ---------------------------------------
  const vRef = 45;
  const rhoRef = RHO0;
  const qRef = 0.5 * rhoRef * vRef * vRef;
  // Pitch: natural frequency ~3.5 rad/s at vRef scaled by pitchRate.
  const wnPitch = 2.4 + 1.6 * p.pitchRate;
  const pitchStiffness = (wnPitch * wnPitch) / qRef;
  const pitchDamping = (2 * 0.55 * wnPitch) / (rhoRef * vRef);
  // Roll: steady roll rate at vRef with full aileron.
  const rollSteady = Math.max(0.7, 2.5 * p.rollRate);
  const rollDamping = 4 / (rhoRef * vRef);
  const rollAuthority = (2 * rollSteady * rollDamping) / vRef;
  // Yaw: full rudder -> ~12 deg steady sideslip, weathercock wn ~2.5 rad/s.
  const wnYaw = 2.2 + 0.6 * p.rollRate;
  const weathercock = (wnYaw * wnYaw) / qRef;
  const yawAuthority = 0.21 * weathercock * (0.8 + 0.3 * p.rollRate);
  const yawDamping = (2 * 0.45 * wnYaw) / (rhoRef * vRef);
  const dihedralEffect = (0.0012 + 0.0004 * g.dihedralDeg) * (g.layout === 'parasol' ? 1.4 : 1);
  const sideForceCoef = 0.35 + (g.crew === 2 ? 0.1 : 0);
  const adverseYaw = 0.12 * rollAuthority;

  const alphaCmdMin = -12 * DEG;
  const alphaCmdMax = alphaStall + 5 * DEG;

  const gLimit = 4 + 5 * p.structuralStrength;
  const vne = vMax * (1.2 + 0.65 * p.structuralStrength);

  const vStallSL = Math.sqrt((2 * weight) / (RHO0 * p.wingArea * clMax));

  // Gear geometry: taildragger sitting ~11 degrees nose-up (less for long two-seaters).
  // Wheels sit ~0.8 m below the lower wing root so lower wingtips clear the grass by ~0.5 m.
  const mainY = g.layout === 'monoplane' ? -1.1 : g.layout === 'parasol' ? -1.0 : -1.2;
  const mainZ = -Math.max(0.25, 0.05 * g.length);
  const tailZ = 0.62 * g.length;
  const groundPitch = (g.crew === 2 ? 9 : 11) * DEG;
  const tailY = mainY + Math.tan(groundPitch) * (tailZ - mainZ);
  const cgHeight = -mainY * Math.cos(groundPitch) + mainZ * Math.sin(groundPitch);

  const co: FlightCoefficients = {
    id: spec.id,
    mass,
    weight,
    wingArea: p.wingArea,
    span: g.span,
    length: g.length,
    aspectRatioEff,
    kInduced,
    cd0: 0.035,
    clAlpha,
    alpha0,
    clMax,
    alphaStall,
    stallSharpness,
    postStallCl: 0.72 + 0.2 * (1 - stallSharpness),
    powerW: p.enginePowerHp * 745.7,
    lapseN: 1.0,
    etaMax: 0.78,
    propDesignV: vMax * 0.9,
    propDiscArea,
    isRotary,
    rpmMax: rpm.max,
    rpmIdle: rpm.idle,
    engineLag: isRotary ? 0.8 : 0.5,
    engineInertia,
    inertiaPitch,
    inertiaYaw,
    inertiaRoll,
    pitchStiffness,
    pitchDamping,
    rollAuthority,
    rollDamping,
    yawAuthority,
    weathercock,
    yawDamping,
    dihedralEffect,
    sideForceCoef,
    adverseYaw,
    alphaTrim: 0,
    alphaCmdMax,
    alphaCmdMin,
    gLimit,
    vne,
    vMax,
    vStallSL,
    vBestClimbSL: 30,
    fuelBurnFull: p.fuelCapacityL / (p.enduranceHours * 3600 * 0.8),
    gear: { mainY, mainZ, halfTrack: g.wheelTrack / 2, tailY, tailZ, groundPitch, cgHeight },
    predicted: { timeTo3000Min: 0, ceilingM: 0 },
  };

  calibrate(co, spec);

  // Hands-off trim: level flight at ~75% of max speed at 1000 m.
  const vt = 0.75 * vMax;
  const clTrim = weight / (0.5 * airDensityAt(1000) * vt * vt * p.wingArea);
  co.alphaTrim = clTrim / clAlpha + alpha0;
  co.vBestClimbSL = bestClimb(co, 0).v;
  co.predicted = { timeTo3000Min: timeToClimb(co, 3000) / 60, ceilingM: serviceCeiling(co) };
  return co;
}

/**
 * Solve (propDesignV, lapseN) so climb-to-3000 m and service ceiling match the
 * spec; cd0 is re-derived at every evaluation so max speed stays pinned.
 */
function calibrate(co: FlightCoefficients, spec: AircraftSpec): void {
  const vMax = co.vMax;
  const targetClimb = spec.performance.climbTo3000mMin * 60;
  const targetCeiling = spec.performance.ceilingM;
  const apply = (vd: number, n: number) => {
    co.propDesignV = vd;
    co.lapseN = n;
    co.cd0 = solveCd0(co, spec);
  };
  let vd = vMax * 0.9;
  let n = 1.0;
  for (let iter = 0; iter < 8; iter++) {
    // Climb time decreases as design speed decreases (more low-speed thrust).
    let lo = vMax * 0.6;
    let hi = vMax * 1.8;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      apply(mid, n);
      if (timeToClimb(co, 3000) < targetClimb) lo = mid;
      else hi = mid;
    }
    vd = (lo + hi) / 2;
    // Ceiling decreases as the lapse exponent increases.
    let nlo = 0.55;
    let nhi = 2.6;
    for (let i = 0; i < 28; i++) {
      const mid = (nlo + nhi) / 2;
      apply(vd, mid);
      if (serviceCeiling(co) > targetCeiling) nlo = mid;
      else nhi = mid;
    }
    n = (nlo + nhi) / 2;
  }
  apply(vd, n);
}
