import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { AimTracker } from './aimStats';

function plane(id: number, side: 'allied' | 'central', z: number): AircraftEntity {
  return {
    id,
    kind: 'aircraft',
    side,
    outcome: null,
    spec: AIRCRAFT.bristol_f2b,
    controls: { fireGuns: false },
    state: { position: new Vector3(0, 1000, z), velocity: new Vector3(0, 0, -50), orientation: new Quaternion() },
  } as unknown as AircraftEntity;
}

describe('AimTracker', () => {
  it("splits the pilot's fixed guns from the rear gun and records aim with the trigger down", () => {
    const player = plane(1, 'allied', 0);
    // Dead ahead, 220 m out, flying with us: the true lead is about on the gun line.
    const enemy = plane(2, 'central', -220);
    const world = { time: 0, aircraft: [player, enemy], balloons: [], groundTargets: [] } as unknown as WorldQuery & { time: number };
    const t = new AimTracker(world, player);
    const pos = new Vector3();
    // Mount 0: the Vickers (fixed); mount 1: the observer's Lewis (flexible).
    t.onEvent({ type: 'gun-fired', shooterId: 1, gun: 'vickers', position: pos, mountIndex: 0 });
    t.onEvent({ type: 'gun-fired', shooterId: 1, gun: 'vickers', position: pos, mountIndex: 0 });
    t.onEvent({ type: 'gun-fired', shooterId: 1, gun: 'lewis', position: pos, mountIndex: 1 });
    t.onEvent({ type: 'gun-fired', shooterId: 2, gun: 'vickers', position: pos, mountIndex: 0 });
    t.onEvent({ type: 'bullet-hit', shooterId: 1, targetId: 2, position: pos, zone: 'fuselage', mountIndex: 0 });
    t.onEvent({ type: 'bullet-hit', shooterId: 1, targetId: 2, position: pos, zone: 'fuselage', mountIndex: 1 });
    player.controls.fireGuns = true;
    for (let i = 0; i < 30; i++) {
      world.time = i / 30;
      t.afterStep();
    }
    const a = t.telemetry();
    expect([a.fixedRoundsFired, a.fixedHits, a.flexibleRoundsFired, a.flexibleHits]).toEqual([2, 1, 1, 1]);
    const held = a.triggerErrorDeg.reduce((x, y) => x + y, 0);
    expect(held).toBeGreaterThan(0.8);
    expect(a.triggerErrorDeg[0] + a.triggerErrorDeg[1]).toBeCloseTo(held);
    // 220 m: the [200, 250) bucket.
    expect(a.triggerRangeM[4]).toBeCloseTo(held);
    // In the cone from the first sample, and a fixed-gun shot came in that sample.
    expect(a.coneToShotS).toEqual([0]);
  });
});
