import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';
import { HUMAN_PILOT, HumanAim, humanPilotFromEnv, type HumanPilotParams } from './humanAim';
import { DEG, makeRng } from './math';

/** A shooter at the origin flying north (-z) at 50 m/s, level. */
function shooter(): AircraftEntity {
  return { state: { position: new Vector3(), velocity: new Vector3(0, 0, -50), orientation: new Quaternion() } } as unknown as AircraftEntity;
}
/** No bias or jitter: only the lag, reaction delay and lead. */
const CLEAN: HumanPilotParams = { ...HUMAN_PILOT, biasRad: 0, noiseRad: 0, leadFraction: 1 };
const DT = 1 / 30;

describe('humanPilotFromEnv', () => {
  it('is off unless AUTOPLAY_PILOT=human, and takes overrides in degrees', () => {
    expect(humanPilotFromEnv({})).toBeUndefined();
    expect(humanPilotFromEnv({ AUTOPLAY_PILOT: 'ai' })).toBeUndefined();
    expect(humanPilotFromEnv({ AUTOPLAY_PILOT: 'human' })).toEqual(HUMAN_PILOT);
    const p = humanPilotFromEnv({ AUTOPLAY_PILOT: 'human', AUTOPLAY_HUMAN: 'aimLagS=0.4,biasDeg=2' })!;
    expect(p.aimLagS).toBe(0.4);
    expect(p.biasRad).toBeCloseTo(2 * DEG);
    expect(() => humanPilotFromEnv({ AUTOPLAY_PILOT: 'human', AUTOPLAY_HUMAN: 'nope=1' })).toThrow(/unknown field/);
  });
});

describe('HumanAim', () => {
  it('takes up a target from the nose and closes on it through the aim lag', () => {
    const h = new HumanAim(CLEAN, makeRng(1));
    const s = shooter();
    // A target 200 m out, 20 degrees right, flying with us: the lead is its own direction.
    const tp = new Vector3(Math.sin(20 * DEG), 0, -Math.cos(20 * DEG)).multiplyScalar(200);
    const tv = new Vector3(0, 0, -50);
    const out = new Vector3();
    const angle = () => out.angleTo(tp) / DEG;
    h.track(s, 7, tp, tv, 800, 0, DT, out);
    expect(angle()).toBeGreaterThan(16);
    let t = 0;
    while (t < CLEAN.aimLagS - 1e-9) h.track(s, 7, tp, tv, 800, (t += DT), DT, out);
    // One time constant: about 63% of the way there (gravity drop adds a fraction of a degree).
    expect(angle()).toBeGreaterThan(20 * 0.25);
    expect(angle()).toBeLessThan(20 * 0.5);
    while (t < 2) h.track(s, 7, tp, tv, 800, (t += DT), DT, out);
    expect(angle()).toBeLessThan(1);
  });

  it('keeps leading the old way for the reaction delay after the target reverses', () => {
    const h = new HumanAim({ ...CLEAN, aimLagS: 0.001 }, makeRng(1));
    const s = shooter();
    const tp = new Vector3(0, 0, -300);
    const out = new Vector3();
    let t = 0;
    // Crossing left to right at 40 m/s for 2 s, then crossing back.
    for (; t < 2; t += DT) h.track(s, 3, tp, new Vector3(40, 0, 0), 800, t, DT, out);
    expect(h.believed.x).toBeGreaterThan(0);
    const back = new Vector3(-40, 0, 0);
    for (const until = t + CLEAN.reactionS * 0.5; t < until; t += DT) h.track(s, 3, tp, back, 800, t, DT, out);
    expect(h.believed.x).toBeGreaterThan(0);
    for (const until = t + CLEAN.reactionS + 0.4; t < until; t += DT) h.track(s, 3, tp, back, 800, t, DT, out);
    expect(h.believed.x).toBeLessThan(0);
  });

  it('fires on its believed lead in bursts, not beyond its range', () => {
    const h = new HumanAim(CLEAN, makeRng(2));
    const size = 0.5 * DEG;
    expect(h.wantsFire(1 * DEG, size, HUMAN_PILOT.fireRangeM + 10, 0)).toBe(false);
    expect(h.wantsFire(HUMAN_PILOT.fireConeRad + size + DEG, size, 200, 0)).toBe(false);
    expect(h.wantsFire(1 * DEG, size, 200, 0)).toBe(true);
    // Mid-burst he holds the trigger through a miss inside the hold cone...
    expect(h.wantsFire(HUMAN_PILOT.fireConeRad + size + DEG, size, 200, 0.1)).toBe(true);
    // ...and after it, waits out the pause.
    expect(h.wantsFire(1 * DEG, size, 200, h.burstUntil + 0.01)).toBe(false);
    expect(h.wantsFire(1 * DEG, size, 200, h.burstNext + 0.01)).toBe(true);
  });
});
