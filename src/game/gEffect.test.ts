import { describe, expect, it } from 'vitest';
import { stepGEffect } from './gEffect';

/** Hold a load factor for `seconds` and return the final effect level. */
function hold(g: number, tolerance: number, seconds: number): number {
  let e = 0;
  for (let t = 0; t < seconds; t += 1 / 60) e = stepGEffect(e, g, tolerance, 1 / 60);
  return e;
}

describe('stepGEffect', () => {
  it('a fit pilot (5.5 g tolerance) is untouched at 4.3 g and greys out at 6 g', () => {
    expect(hold(4.3, 5.5, 5)).toBeCloseTo(0, 3);
    expect(hold(6, 5.5, 3)).toBeGreaterThan(0.5);
  });

  it('a wounded pilot greys out at loads a fit pilot shrugs off', () => {
    expect(hold(4.3, 5.5, 4)).toBeLessThan(0.01);
    expect(hold(4.3, 3.5, 4)).toBeGreaterThan(0.5);
  });

  it('wounds bring red-out on sooner too', () => {
    expect(hold(-1.3, 5.5, 3)).toBeCloseTo(0, 3);
    expect(hold(-1.3, 3, 3)).toBeLessThan(-0.2);
  });

  it('recovers toward zero at moderate load', () => {
    let e = 0.8;
    for (let i = 0; i < 300; i++) e = stepGEffect(e, 1, 5.5, 1 / 60);
    expect(Math.abs(e)).toBeLessThan(0.1);
  });
});
