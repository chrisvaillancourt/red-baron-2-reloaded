import { describe, expect, it } from 'vitest';
import { poissonInterval, ratesLine, wilsonInterval } from './stats';

describe('soak statistics', () => {
  it('Wilson interval for a proportion', () => {
    const [lo, hi] = wilsonInterval(5, 10);
    expect(lo).toBeCloseTo(0.237, 2);
    expect(hi).toBeCloseTo(0.763, 2);
    // Zero events still has an upper bound (the "4% ± nothing" trap).
    const [lo0, hi0] = wilsonInterval(0, 20);
    expect(lo0).toBe(0);
    expect(hi0).toBeCloseTo(0.161, 2);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('Poisson interval for a count (collisions)', () => {
    const [lo, hi] = poissonInterval(4);
    expect(lo).toBeGreaterThan(1);
    expect(lo).toBeLessThan(1.7);
    expect(hi).toBeGreaterThan(9.5);
    expect(hi).toBeLessThan(10.5);
    expect(poissonInterval(0)[0]).toBe(0);
  });

  it('prints one machine-readable RATES line for tools/dev/ab.mjs', () => {
    expect(ratesLine({ missions: 245, killed: 48, captured: 5, collisions: 4, playerCollisions: 0 })).toBe(
      'RATES missions=245 killedCaptured=53 kc%=21.6 kcLo=16.9 kcHi=27.2 coll=4 coll100=1.6 collLo100=0.6 collHi100=4.2 playerColl=0',
    );
  });
});
