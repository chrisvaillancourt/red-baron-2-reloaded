/**
 * International Standard Atmosphere (troposphere + lower stratosphere) and the
 * FlightEnvironment factory used by the flight session.
 */
import type { Vector3 } from 'three';
import type { FlightEnvironment, Weather } from '../core/types';

export const G = 9.80665;
export const RHO0 = 1.225;
const T0 = 288.15;
const P0 = 101_325;
const LAPSE = 0.0065;
const R_AIR = 287.05;

/** ISA temperature (K) at geometric altitude (m). */
export function temperatureAt(altitudeM: number): number {
  const h = Math.max(-500, altitudeM);
  return h < 11_000 ? T0 - LAPSE * h : 216.65;
}

/** ISA air density (kg/m^3) at altitude (m). */
export function airDensityAt(altitudeM: number): number {
  const h = Math.max(-500, altitudeM);
  if (h < 11_000) {
    const t = T0 - LAPSE * h;
    const p = P0 * Math.pow(t / T0, 5.25588);
    return p / (R_AIR * t);
  }
  const p11 = P0 * Math.pow(216.65 / T0, 5.25588);
  const p = p11 * Math.exp((-G * (h - 11_000)) / (R_AIR * 216.65));
  return p / (R_AIR * 216.65);
}

/** Density ratio sigma = rho / rho0. */
export function densityRatio(altitudeM: number): number {
  return airDensityAt(altitudeM) / RHO0;
}

export interface SimFlightEnvironment extends FlightEnvironment {
  /** Seconds of simulated time; drives gusts. */
  time: number;
  /** Advance the gust clock. Call once per fixed step. */
  advance(dt: number): void;
}

/**
 * Build the flight environment. Wind scales with height above ground (weaker
 * near the ground, reference value at 1000 m); turbulence adds a smooth,
 * spatially varying gust field that drifts with the wind.
 */
export function createFlightEnvironment(
  groundHeightAt: (x: number, z: number) => number,
  weather: Pick<Weather, 'wind' | 'turbulence'>,
): SimFlightEnvironment {
  const [wx, wy, wz] = weather.wind;
  const turbulence = Math.max(0, Math.min(1, weather.turbulence));
  const env: SimFlightEnvironment = {
    time: 0,
    turbulence,
    groundHeightAt,
    airDensityAt,
    windAt(position: Vector3, out: Vector3): Vector3 {
      const h = Math.max(1, position.y - groundHeightAt(position.x, position.z));
      const scale = Math.min(1.4, Math.max(0.3, Math.pow(h / 1000, 0.25)));
      out.set(wx * scale, wy * scale, wz * scale);
      if (turbulence > 0) {
        const t = env.time;
        const px = position.x - wx * t;
        const pz = position.z - wz * t;
        const py = position.y;
        // Sum of incommensurate sines: cheap, smooth, deterministic "noise".
        const g = turbulence * 3.5 * (h < 400 ? 1.4 : 1);
        out.x += g * (Math.sin(px * 0.011 + t * 0.7) * 0.6 + Math.sin(pz * 0.027 + py * 0.013 + t * 1.9) * 0.4);
        out.y += g * 0.6 * (Math.sin(px * 0.019 + pz * 0.008 + t * 1.3) * 0.6 + Math.sin(py * 0.031 - t * 2.3) * 0.4);
        out.z += g * (Math.sin(pz * 0.013 - t * 0.9) * 0.6 + Math.sin(px * 0.023 - py * 0.017 + t * 1.7) * 0.4);
      }
      return out;
    },
    advance(dt: number) {
      env.time += dt;
    },
  };
  return env;
}
