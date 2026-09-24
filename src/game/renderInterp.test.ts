import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import { RenderInterpolator } from './renderInterp';

function fakeAircraft(id: number): AircraftEntity {
  return { id, state: { position: new Vector3(), orientation: new Quaternion() } } as unknown as AircraftEntity;
}

describe('RenderInterpolator', () => {
  it('blends between the last two sim steps and restores the true state', () => {
    const ac = fakeAircraft(1);
    const it = new RenderInterpolator();
    it.capture([ac]);
    ac.state.position.set(10, 0, 0); // one sim step later
    ac.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
    it.apply([ac], 0.25);
    expect(ac.state.position.x).toBeCloseTo(2.5);
    expect(ac.state.orientation.angleTo(new Quaternion())).toBeCloseTo(0.05, 3);
    it.restore();
    expect(ac.state.position.x).toBe(10);
    expect(ac.state.orientation.angleTo(new Quaternion())).toBeCloseTo(0.2, 5);
  });

  it('snaps on teleports and ignores aircraft never captured', () => {
    const a = fakeAircraft(1);
    const b = fakeAircraft(2);
    const it = new RenderInterpolator();
    it.capture([a]);
    a.state.position.set(5000, 0, 0);
    b.state.position.set(7, 0, 0);
    it.apply([a, b], 0.5);
    expect(a.state.position.x).toBe(5000);
    expect(b.state.position.x).toBe(7);
    it.restore();
  });
});
