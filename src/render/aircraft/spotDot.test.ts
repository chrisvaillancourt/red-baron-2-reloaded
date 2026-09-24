import { describe, expect, it } from 'vitest';
import { spotDotOpacity } from './spotDot';

// 720 px tall viewport at 70° vertical FOV.
const PX_PER_RAD = 360 / Math.tan((35 * Math.PI) / 180);

describe('spotting dot', () => {
  it('is invisible when the model itself is plainly visible', () => {
    expect(spotDotOpacity(8.5, 200, PX_PER_RAD)).toBe(0); // ~22 px span
    expect(spotDotOpacity(8.5, 800, PX_PER_RAD)).toBeLessThan(0.35); // ~5.5 px span: mostly the model
  });

  it('keeps a scout visible at 2-3 km, where its span is 1-2 px', () => {
    expect(spotDotOpacity(8.5, 2000, PX_PER_RAD)).toBeGreaterThan(0.9);
    expect(spotDotOpacity(8.5, 3000, PX_PER_RAD)).toBeGreaterThan(0.9);
  });

  it('fades out beyond spotting range', () => {
    expect(spotDotOpacity(8.5, 6000, PX_PER_RAD)).toBeLessThan(0.6);
    expect(spotDotOpacity(8.5, 9500, PX_PER_RAD)).toBe(0);
  });

  it('ignores the viewer’s own aircraft', () => {
    expect(spotDotOpacity(8.5, 0.5, PX_PER_RAD)).toBe(0);
  });
});
