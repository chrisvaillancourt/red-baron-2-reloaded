/**
 * The mouse-aim instructor's stall margin is its own setting, widest on 'relaxed'
 * (it used to be derived from the dive-caution value, which gave relaxed the
 * narrowest margin). Behavioural check: yank the aim point far up and behind
 * (a maximum pull) and compare the peak angle of attack per level.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftId, FlightModelLevel } from '../core/types';
import { createMouseAimState, INSTRUCTOR, mouseAimAssist } from '../game/input';
import { getCoefficients } from '../sim';
import { SimWorld, runSim, STANDARD_REALISM } from './testing/realSimHarness';
import { Autopilot } from './autopilot';
import { traitsFor } from './traits';
import { getAircraft } from '../data/aircraft';

function peakAoa(aircraft: AircraftId, level: FlightModelLevel): { peakAoaDeg: number; stallDeg: number; stalledS: number } {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level }, ground: () => 60 });
  const ac = w.addAircraft({ aircraftId: aircraft, side: 'allied', x: 0, z: 0, alt: 1800, heading: 0, controller: 'player' });
  const st = createMouseAimState();
  let peak = 0;
  let stalledS = 0;
  const script = new Map<number, (a: typeof ac, dt: number) => void>();
  script.set(ac.id, (a, dt) => {
    // Aim held 110 deg round to the right, near level: a sustained maximum turn.
    const f = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation).setY(0).normalize();
    const right = new Vector3(-f.z, 0, f.x);
    const aim = f.clone().multiplyScalar(Math.cos((110 * Math.PI) / 180)).addScaledVector(right, Math.sin((110 * Math.PI) / 180)).setY(0.05).normalize();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    mouseAimAssist(a, aim, st, w, level, dt, out);
    a.controls.pitch = out.pitch;
    a.controls.roll = out.roll;
    a.controls.yaw = out.yaw;
    a.controls.throttle = 1;
    if (w.time > 2) peak = Math.max(peak, a.state.aoa);
    if (a.state.stalled) stalledS += dt;
  });
  runSim(w, 25, { scripted: script, aiEvery: 2 });
  return { peakAoaDeg: (peak * 180) / Math.PI, stallDeg: (getCoefficients(ac.spec).alphaStall * 180) / Math.PI, stalledS };
}

describe('instructor stall margin', () => {
  it('relaxed keeps the widest margin, authentic the narrowest (presets)', () => {
    expect(INSTRUCTOR.relaxed.stallMarginDeg).toBeGreaterThan(INSTRUCTOR.standard.stallMarginDeg);
    expect(INSTRUCTOR.standard.stallMarginDeg).toBeGreaterThan(INSTRUCTOR.authentic.stallMarginDeg);
    // Dive caution is independent and still widest on relaxed.
    expect(INSTRUCTOR.relaxed.caution).toBeGreaterThanOrEqual(INSTRUCTOR.authentic.caution);
  });

  it('the autopilot honours an explicit stall margin over the caution-derived one', () => {
    const ap = new Autopilot(traitsFor(getAircraft('sopwith_camel')), 5, 60, 1, 1, null);
    ap.diveCaution = 1; // caution-derived margin would be 1.0 deg
    expect((ap.stallMarginRad() * 180) / Math.PI).toBeCloseTo(1.0, 5);
    ap.stallMarginDeg = 3.2;
    expect((ap.stallMarginRad() * 180) / Math.PI).toBeCloseTo(3.2, 5);
  });

  for (const type of ['sopwith_camel', 'albatros_dv'] as AircraftId[]) {
    it(`${type}: in a maximum pull, relaxed peaks at a lower AoA than authentic and never stalls`, () => {
      const relaxed = peakAoa(type, 'relaxed');
      const authentic = peakAoa(type, 'authentic');
      expect(relaxed.stalledS).toBe(0);
      expect(relaxed.peakAoaDeg).toBeLessThan(relaxed.stallDeg - 1.5);
      expect(relaxed.peakAoaDeg).toBeLessThan(authentic.peakAoaDeg);
    });
  }
});

