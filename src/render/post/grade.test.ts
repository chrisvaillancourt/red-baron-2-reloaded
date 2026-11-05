import { describe, expect, it } from 'vitest';
import { QUALITY } from '../quality';
import { gradeFor } from './grade';

describe('gradeFor', () => {
  it('adds contrast and saturation on a clear day without tinting it', () => {
    const g = gradeFor(50, 0, 30_000);
    expect(g.contrast).toBeGreaterThan(0.15);
    expect(g.saturation).toBeGreaterThan(1);
    expect(g.gain[0]).toBeCloseTo(1, 5);
    expect(g.gain[2]).toBeCloseTo(1, 5);
  });

  it('warms highlights and cools shadows when the sun is low', () => {
    const g = gradeFor(3, 0, 30_000);
    expect(g.gain[0]).toBeGreaterThan(1);
    expect(g.gain[2]).toBeLessThan(1);
    expect(g.lift[2]).toBeGreaterThan(gradeFor(50, 0, 30_000).lift[2]);
  });

  it('pulls overcast and thick haze back toward neutral', () => {
    const clear = gradeFor(40, 0, 30_000);
    const grey = gradeFor(40, 1, 30_000);
    const hazy = gradeFor(40, 0, 6000);
    expect(grey.contrast).toBeLessThan(clear.contrast);
    expect(grey.saturation).toBeLessThan(clear.saturation);
    expect(hazy.contrast).toBeLessThan(clear.contrast);
  });

  it('keeps every value in a safe display range', () => {
    for (const el of [-5, 0, 10, 30, 70]) {
      for (const oc of [0, 0.5, 1]) {
        const g = gradeFor(el, oc, 8000);
        expect(g.contrast).toBeGreaterThanOrEqual(0);
        expect(g.contrast).toBeLessThanOrEqual(0.5);
        expect(g.saturation).toBeGreaterThanOrEqual(1);
        expect(g.saturation).toBeLessThan(1.3);
        for (const v of [...g.gain, ...g.lift]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('post-processing presets', () => {
  it('leaves the low preset without post effects, and bloom only where post is on', () => {
    expect(QUALITY.low.postFx).toBe(false);
    for (const q of Object.values(QUALITY)) if (q.bloom) expect(q.postFx).toBe(true);
  });
});
