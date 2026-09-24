/**
 * Take-off and landing with mouse-aim on the REAL flight model, flown by a
 * simple "human" who points the mouse where they want to go.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, AircraftId, FlightModelLevel } from '../core/types';
import { SimWorld, runSim, STANDARD_REALISM } from '../ai/testing/realSimHarness';
import { isStoppedOnGround } from '../sim';
import { createMouseAimState, mouseAimAssist } from './input';

const GROUND = 60;

function takeoff(id: AircraftId, level: FlightModelLevel) {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level }, ground: () => GROUND });
  const p = w.addAircraft({ aircraftId: id, side: 'allied', x: 0, z: 0, alt: GROUND, heading: 0, controller: 'player', onGround: true });
  const st = createMouseAimState();
  // Aim down the runway, 10° up: "go that way, climb out".
  const aim = new Vector3(0, Math.sin(0.17), -Math.cos(0.17));
  let liftoff = -1;
  let maxBank = 0;
  const script = new Map<number, (ac: AircraftEntity, dt: number) => void>();
  script.set(p.id, (ac, dt) => {
    const out = { pitch: 0, roll: 0, yaw: 0 };
    ac.controls.throttle = 1;
    mouseAimAssist(ac, aim, st, w, level, dt, out);
    Object.assign(ac.controls, out);
    if (liftoff < 0 && !ac.state.onGround && ac.state.heightAboveGround > 3) liftoff = w.time;
    const r = new Vector3(1, 0, 0).applyQuaternion(ac.state.orientation);
    if (ac.state.onGround) maxBank = Math.max(maxBank, Math.abs(Math.asin(Math.max(-1, Math.min(1, r.y)))));
  });
  runSim(w, 60, { scripted: script, aiEvery: 2 });
  return { liftoff, agl: p.state.heightAboveGround, outcome: p.outcome, maxBank, x: p.state.position.x };
}

function landing(id: AircraftId, level: FlightModelLevel) {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level }, ground: () => GROUND, frontX: 10_000 });
  const p = w.addAircraft({ aircraftId: id, side: 'allied', x: 0, z: 2000, alt: GROUND + 140, heading: 0, controller: 'player' });
  p.state.velocity.multiplyScalar(0.7);
  const st = createMouseAimState();
  const touchdown = new Vector3(0, GROUND, 0);
  const aim = new Vector3();
  let touched = -1;
  let maxSink = 0;
  const script = new Map<number, (ac: AircraftEntity, dt: number) => void>();
  script.set(p.id, (ac, dt) => {
    const s = ac.state;
    ac.controls.throttle = s.heightAboveGround < 15 || s.onGround ? 0 : 0.1; // chop it over the fence
    // Point at the touchdown spot; inside 10 m, raise the aim to the horizon to flare.
    if (s.heightAboveGround > 10 && s.position.z > touchdown.z + 50) aim.copy(touchdown).sub(s.position).normalize();
    else aim.set(0, 0.02, -1).normalize();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    mouseAimAssist(ac, aim, st, w, level, dt, out);
    Object.assign(ac.controls, out);
    if (touched < 0 && s.onGround) {
      touched = w.time;
      maxSink = -s.velocity.y;
    }
  });
  runSim(w, 90, { scripted: script, aiEvery: 2, onStep: () => touched > 0 && (p.outcome !== null || isStoppedOnGround(p)) });
  return { touched, outcome: p.outcome, stopped: p.outcome === 'landed-friendly' || (p.outcome === null && isStoppedOnGround(p)), maxSink, v: +p.state.airspeed.toFixed(1), gnd: p.state.onGround, agl: +p.state.heightAboveGround.toFixed(1), t: +w.time.toFixed(1) };
}

const TYPES: AircraftId[] = ['sopwith_camel', 'albatros_dv', 'spad_xiii', 'fokker_dri'];

describe('mouse-aim field work on the real sim', () => {
  for (const id of TYPES) {
    it(`${id}: takes off down the runway and climbs out`, () => {
      const r = takeoff(id, 'standard');
      expect(r.outcome).toBeNull();
      expect(r.liftoff).toBeGreaterThan(0);
      expect(r.liftoff).toBeLessThan(35);
      expect(r.agl).toBeGreaterThan(60);
      expect(Math.abs(r.x)).toBeLessThan(300); // kept straight
    });
    it(`${id}: lands on the aim point and rolls to a stop`, () => {
      const r = landing(id, 'standard');
      expect(r.touched).toBeGreaterThan(0);
      expect(r.stopped, JSON.stringify(r)).toBe(true); // the harness books a stop on the ground as landed-friendly
      expect(r.maxSink).toBeLessThan(4);
    });
  }
});
