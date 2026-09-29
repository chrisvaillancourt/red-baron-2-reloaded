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

type TestWorld = WorldQuery & { time: number };
const world = (...aircraft: AircraftEntity[]) => ({ time: 0, aircraft, balloons: [], groundTargets: [] }) as unknown as TestWorld;
const pos = new Vector3();
/** One Bristol round from mount 0 (the pilot's Vickers) or 1 (the observer's Lewis). */
const shot = (t: AimTracker, shooterId: number, mountIndex: 0 | 1) => t.onEvent({ type: 'gun-fired', shooterId, gun: mountIndex ? 'lewis' : 'vickers', position: pos, mountIndex });
const hit = (t: AimTracker, mountIndex: 0 | 1) => t.onEvent({ type: 'bullet-hit', shooterId: 1, targetId: 2, position: pos, zone: 'fuselage', mountIndex });
/** One second of 30 Hz samples, with the pilot's Vickers firing a round every other sample. */
function secondOfFire(t: AimTracker, w: TestWorld, firing = true) {
  for (let i = 0; i < 30; i++) {
    w.time += 1 / 30;
    if (firing && i % 2 === 0) shot(t, 1, 0);
    t.afterStep();
  }
}
const total = (h: number[]) => h.reduce((x, y) => x + y, 0);

describe('AimTracker', () => {
  it("splits the player's guns from the AI crew's and records aim while his guns fire", () => {
    const player = plane(1, 'allied', 0);
    // Dead ahead, 220 m out, flying with us: the true lead is about on the gun line.
    const w = world(player, plane(2, 'central', -220));
    const t = new AimTracker(w, player);
    // The player flies (no station inputs): the Vickers is his, the Lewis the AI observer's.
    shot(t, 1, 0);
    shot(t, 1, 1);
    shot(t, 2, 0);
    hit(t, 0);
    hit(t, 1);
    secondOfFire(t, w);
    const a = t.telemetry();
    // 1 + 15 Vickers rounds, 1 Lewis.
    expect([a.playerRoundsFired, a.playerHits, a.crewRoundsFired, a.crewHits]).toEqual([16, 1, 1, 1]);
    const held = total(a.triggerErrorDeg);
    expect(held).toBeGreaterThan(0.8);
    expect(a.triggerErrorDeg[0] + a.triggerErrorDeg[1]).toBeCloseTo(held);
    // 220 m: the [200, 250) bucket.
    expect(a.triggerRangeM[4]).toBeCloseTo(held);
    // In the cone from the first sample, and a fixed-gun shot came in that sample.
    expect(a.coneToShotS).toEqual([0]);
  });

  it('credits the rear gun to the player when he works the observer station', () => {
    const player = plane(1, 'allied', 0);
    player.stationInputs = { station: 'observer', aim: new Vector3(0, 0, 1), fire: true, releaseBomb: false, clearJam: false };
    const t = new AimTracker(world(player), player);
    shot(t, 1, 1);
    shot(t, 1, 1);
    shot(t, 1, 0);
    hit(t, 1);
    hit(t, 0);
    const a = t.telemetry();
    expect([a.playerRoundsFired, a.playerHits, a.crewRoundsFired, a.crewHits]).toEqual([2, 1, 1, 1]);
  });

  it('records aim error only while his fixed guns fire at an enemy ahead', () => {
    const player = plane(1, 'allied', 0);
    // An enemy 150 m astern: nothing to do with where the nose points.
    const w = world(player, plane(2, 'central', 150));
    const t = new AimTracker(w, player);
    secondOfFire(t, w);
    expect(total(t.telemetry().triggerErrorDeg)).toBe(0);
    // Ahead, with the trigger held but no gun firing (jammed, or empty): no aim sample either.
    const w2 = world(player, plane(2, 'central', -220));
    const t2 = new AimTracker(w2, player);
    player.controls.fireGuns = true;
    secondOfFire(t2, w2, false);
    expect(total(t2.telemetry().triggerErrorDeg)).toBe(0);
    expect(total(t2.telemetry().triggerRangeM)).toBe(0);
  });
});
