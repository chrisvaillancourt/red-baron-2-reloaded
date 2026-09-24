import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Autopilot } from './autopilot';
import { traitsFor } from './traits';
import { makeAircraft, TestWorld } from './testing/testWorld';
import { PointMassModel } from './testing/pointMassModel';
import { angleBetween, dirFromHeading } from './math';
import type { AircraftId } from '../core/types';

function fly(aircraftId: AircraftId, dirFn: (t: number) => Vector3, seconds: number, speed = Infinity, startAlt = 1500) {
  const world = new TestWorld();
  const ac = makeAircraft({ aircraftId, side: 'allied', x: 0, z: 0, alt: startAlt, heading: 0 });
  world.aircraft.push(ac);
  const ap = new Autopilot(traitsFor(ac.spec), 4.5, 100, ac.spec.performance.rollRate, ac.spec.performance.pitchRate);
  const model = new PointMassModel(ac.spec);
  const dt = 1 / 120;
  let t = 0;
  let i = 0;
  const trace: { t: number; y: number; dirErr: number; v: number }[] = [];
  while (t < seconds) {
    if (i % 4 === 0) ap.fly(ac, { dir: dirFn(t), speed }, world, dt * 4);
    model.step(ac, world.env, dt);
    t += dt;
    i++;
    if (i % 60 === 0) trace.push({ t, y: ac.state.position.y, dirErr: angleBetween(ac.state.velocity, dirFn(t)), v: ac.state.velocity.length() });
  }
  return { ac, trace };
}

describe('autopilot', () => {
  it('holds level flight straight ahead', () => {
    const { ac, trace } = fly('se5a', () => dirFromHeading(0), 30);
    expect(ac.outcome).toBeNull();
    for (const p of trace.slice(10)) expect(Math.abs(p.y - 1500)).toBeLessThan(60);
  });

  for (const id of ['sopwith_camel', 'albatros_dv', 'fokker_dri', 'spad_xiii', 'rumpler_civ'] as AircraftId[]) {
    it(`${id}: reverses course and settles on the new heading at constant altitude`, () => {
      const { ac, trace } = fly(id, () => dirFromHeading(Math.PI), 60);
      expect(ac.outcome).toBeNull();
      const late = trace.filter((p) => p.t > 40);
      for (const p of late) {
        expect(p.dirErr).toBeLessThan(0.1);
        expect(Math.abs(p.y - 1500)).toBeLessThan(250);
      }
    });
  }

  it('climbs and dives on command without stalling for long', () => {
    const climb = fly('fokker_dri', () => new Vector3(0, 0.35, -1), 40);
    expect(climb.ac.state.position.y).toBeGreaterThan(1640);
    expect(climb.ac.state.stalled).toBe(false);
    const dive = fly('spad_xiii', () => new Vector3(0, -0.5, -1), 15, Infinity, 3000);
    expect(dive.ac.state.position.y).toBeLessThan(2650);
    expect(dive.ac.outcome).toBeNull();
  });

  it('tracks a commanded airspeed', () => {
    const { trace } = fly('se5a', () => dirFromHeading(0), 60, 45);
    const late = trace.filter((p) => p.t > 45);
    for (const p of late) expect(Math.abs(p.v - 45)).toBeLessThan(5);
  });

  it('refuses to fly into the ground when commanded to dive', () => {
    const { ac } = fly('albatros_dv', () => new Vector3(0, -1, -0.3), 40, Infinity, 800);
    expect(ac.outcome).toBeNull();
    expect(ac.state.heightAboveGround).toBeGreaterThan(20);
  });
});
