import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightEnvironment } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { driftAngle, nextStoreIndex, predictBombImpact, releaseSolution } from './bombsight';

const G = 9.81;

function env(wind = new Vector3(), ground = 0): Pick<FlightEnvironment, 'groundHeightAt' | 'airDensityAt' | 'windAt'> {
  return {
    groundHeightAt: () => ground,
    airDensityAt: (h) => 1.225 * Math.exp(-h / 8500),
    windAt: (_p, out) => out.copy(wind),
  };
}

describe('bomb impact prediction', () => {
  it('matches the vacuum drop without drag', () => {
    const h = 2000;
    const v = 50;
    const p = predictBombImpact(new Vector3(0, h, 0), new Vector3(0, 0, -v), env(), 50, { drag: false })!;
    const t = Math.sqrt((2 * h) / G);
    expect(p.time).toBeCloseTo(t, 1);
    expect(p.point.z).toBeCloseTo(-v * t, -0.5); // within a few metres
    expect(Math.abs(p.point.x)).toBeLessThan(1e-6);
    expect(p.point.y).toBeCloseTo(0, 3);
  });

  it('falls short of the vacuum drop with drag, a little from 2 km', () => {
    const start = new Vector3(0, 2000, 0);
    const vel = new Vector3(0, 0, -50);
    const vac = predictBombImpact(start, vel, env(), 50, { drag: false })!;
    const real = predictBombImpact(start, vel, env(), 50)!;
    const short = real.point.z - vac.point.z; // negative z is forward, so short > 0 means behind
    expect(real.point.z).toBeGreaterThan(vac.point.z);
    expect(short).toBeGreaterThan(1);
    expect(short).toBeLessThan(0.1 * Math.abs(vac.point.z));
    expect(real.time).toBeGreaterThan(vac.time);
  });

  it('drifts downwind', () => {
    const p = predictBombImpact(new Vector3(0, 2000, 0), new Vector3(0, 0, -50), env(new Vector3(8, 0, 0)), 50)!;
    expect(p.point.x).toBeGreaterThan(5);
  });

  it('lands on high ground sooner', () => {
    const low = predictBombImpact(new Vector3(0, 2000, 0), new Vector3(0, 0, -50), env(), 50)!;
    const high = predictBombImpact(new Vector3(0, 2000, 0), new Vector3(0, 0, -50), env(new Vector3(), 500), 50)!;
    expect(high.time).toBeLessThan(low.time);
    expect(high.point.y).toBeCloseTo(500, 3);
  });

  it('gives no impact from the ground', () => {
    expect(predictBombImpact(new Vector3(0, -1, 0), new Vector3(), env(), 50)).toBeNull();
  });
});

describe('release solution', () => {
  const impact = new Vector3(0, 0, -800);
  const groundVel = new Vector3(0, 0, -50);

  it('counts down to a target ahead on the track', () => {
    const s = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(0, 0, -1800) }], 25);
    expect(s.cue).toBe('run-in');
    expect(s.targetId).toBe(7);
    expect(s.alongM).toBeCloseTo(1000, 3);
    expect(s.timeToRelease).toBeCloseTo(20, 3);
  });

  it('says release when the target is under the predicted impact', () => {
    const s = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(10, 0, -805) }], 25);
    expect(s.cue).toBe('release');
  });

  it('says steer when the target is off the track, and past once it is behind', () => {
    const off = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(120, 0, -1400) }], 25);
    expect(off.cue).toBe('run-in');
    expect(off.crossM).toBeCloseTo(120, 3); // positive: right of the track
    const past = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(0, 0, -600) }], 25);
    expect(past.cue).toBe('past');
  });

  it('picks the target nearest the track ahead, and none when nothing is near', () => {
    const s = releaseSolution(
      impact,
      groundVel,
      [
        { id: 1, position: new Vector3(600, 0, -1500) },
        { id: 2, position: new Vector3(40, 0, -2500) },
      ],
      25,
    );
    expect(s.targetId).toBe(2);
    expect(releaseSolution(impact, groundVel, [{ id: 3, position: new Vector3(5000, 0, 0) }], 25).cue).toBe('none');
    expect(releaseSolution(impact, groundVel, [], 25).cue).toBe('none');
  });
});

describe('drift and stores', () => {
  it('measures the drift between the heading and the ground track', () => {
    // Heading north, wind from the west pushing east: the track drifts right (positive).
    const heading = new Vector3(0, 0, -1);
    const d = driftAngle(heading, new Vector3(10, 0, -50));
    expect(d).toBeCloseTo(Math.atan2(10, 50), 6);
    expect(driftAngle(heading, new Vector3(0, 0, -50))).toBeCloseTo(0, 9);
  });

  it('releases the heaviest store with bombs left first', () => {
    const spec = { ...getAircraft('dh4'), bombs: [{ name: 'A', massKg: 20, explosiveKg: 8, count: 4 }, { name: 'B', massKg: 50, explosiveKg: 20, count: 2 }] };
    expect(nextStoreIndex(spec, [4, 2])).toBe(1);
    expect(nextStoreIndex(spec, [4, 0])).toBe(0);
    expect(nextStoreIndex(spec, [0, 0])).toBeNull();
    expect(nextStoreIndex(spec, undefined)).toBeNull();
  });
});
