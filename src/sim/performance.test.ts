/**
 * Flies every aircraft in the 6-DOF model and compares with historical figures:
 * max level speed (+-8%), time to 3000 m (+-25%), service ceiling (rough).
 */
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { Autopilot } from './autopilot';
import { bestClimb, getCoefficients } from './coefficients';
import { SIM_DT, stepFlight } from './flightModel';
import { makeAircraft, realism } from './testUtil';

const R = realism({ engineTorque: false, autoRudder: true, flightModel: 'standard' });

function measureMaxSpeed(id: (typeof AIRCRAFT_LIST)[number]['id']): number {
  const spec = AIRCRAFT_LIST.find((s) => s.id === id)!;
  const alt = Math.max(spec.performance.maxSpeedAltM, 300);
  const { ac, env } = makeAircraft(id, { altitude: alt, airspeed: (spec.performance.maxSpeedKmh / 3.6) * 0.95 });
  const ap = new Autopilot();
  let sum = 0;
  let n = 0;
  const T = 150;
  for (let t = 0; t < T; t += SIM_DT) {
    ap.update(ac, { altitude: alt, throttle: 1 }, SIM_DT);
    stepFlight(ac, env, R, SIM_DT);
    env.advance(SIM_DT);
    if (t > T - 15) {
      sum += ac.state.airspeed;
      n++;
    }
  }
  return (sum / n) * 3.6;
}

function measureClimb(id: (typeof AIRCRAFT_LIST)[number]['id']): number {
  const spec = AIRCRAFT_LIST.find((s) => s.id === id)!;
  const co = getCoefficients(spec);
  // Ground far below sea level so the climb can start at 0 m without ground contact.
  const { ac, env } = makeAircraft(id, { altitude: 0, airspeed: co.vBestClimbSL, groundH: -500 });
  const ap = new Autopilot();
  let t = 0;
  while (ac.state.position.y < 3000 && t < 3600) {
    const vy = bestClimb(co, ac.state.position.y).v;
    ap.update(ac, { airspeedByPitch: vy, throttle: 1 }, SIM_DT);
    stepFlight(ac, env, R, SIM_DT);
    env.advance(SIM_DT);
    t += SIM_DT;
    if (ac.outcome) break;
  }
  return t / 60;
}

function rocAt(id: (typeof AIRCRAFT_LIST)[number]['id'], alt: number): number {
  const spec = AIRCRAFT_LIST.find((s) => s.id === id)!;
  const co = getCoefficients(spec);
  const vy = bestClimb(co, alt).v;
  const { ac, env } = makeAircraft(id, { altitude: alt, airspeed: vy });
  const ap = new Autopilot();
  let y0 = 0;
  for (let t = 0; t < 60; t += SIM_DT) {
    if (Math.abs(t - 30) < SIM_DT / 2) y0 = ac.state.position.y;
    ap.update(ac, { airspeedByPitch: vy, throttle: 1 }, SIM_DT);
    stepFlight(ac, env, R, SIM_DT);
    env.advance(SIM_DT);
  }
  return (ac.state.position.y - y0) / 30;
}

describe('6-DOF performance vs historical figures', () => {
  const rows: string[] = [];
  for (const spec of AIRCRAFT_LIST) {
    it(`${spec.id}`, () => {
      const p = spec.performance;
      const vmax = measureMaxSpeed(spec.id);
      const climb = measureClimb(spec.id);
      const rocLow = rocAt(spec.id, p.ceilingM * 0.8);
      const rocHigh = rocAt(spec.id, p.ceilingM * 1.12);
      rows.push(
        `${spec.id.padEnd(18)} vmax ${vmax.toFixed(0)}/${p.maxSpeedKmh} (${((vmax / p.maxSpeedKmh - 1) * 100).toFixed(1)}%)  ` +
          `climb3000 ${climb.toFixed(1)}/${p.climbTo3000mMin} min (${((climb / p.climbTo3000mMin - 1) * 100).toFixed(0)}%)  ` +
          `RoC@0.8ceil ${rocLow.toFixed(2)} RoC@1.12ceil ${rocHigh.toFixed(2)}`,
      );
      if (rows.length === AIRCRAFT_LIST.length) console.log(rows.join('\n'));
      expect(Math.abs(vmax / p.maxSpeedKmh - 1)).toBeLessThan(0.08);
      expect(Math.abs(climb / p.climbTo3000mMin - 1)).toBeLessThan(0.25);
      expect(rocLow).toBeGreaterThan(0.5);
      expect(rocHigh).toBeLessThan(1.0);
    });
  }
});
