import { describe, expect, it } from 'vitest';
import { placeLabel, type Rect } from './labels';

const sheet: Rect = { x: 0, y: 0, w: 800, h: 600 };

describe('map label placement', () => {
  it('puts a lone label to the right of its anchor', () => {
    const r = placeLabel(100, 100, 9, 80, 14, 3, [], sheet);
    expect(r.x).toBeGreaterThan(100);
    expect(r.y).toBeCloseTo(93);
  });

  it('flips left at the right edge of the sheet', () => {
    const r = placeLabel(780, 100, 9, 80, 14, 3, [], sheet);
    expect(r.x + r.w).toBeLessThan(780);
  });

  it('moves off a label already placed next to a nearby waypoint', () => {
    const first = placeLabel(400, 300, 9, 120, 14, 3, [], sheet);
    const second = placeLabel(420, 302, 9, 120, 14, 3, [first, { x: 391, y: 291, w: 18, h: 18 }], sheet);
    const ox = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x);
    const oy = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y);
    expect(ox > 0 && oy > 0).toBe(false);
  });
});
