import { describe, expect, it } from 'vitest';
import { SegmentIndex, type NearestHit } from './segmentIndex';

const makeHit = (): NearestHit => ({ distance: 0, line: 0, segment: 0, t: 0, along: 0, side: 1 });

describe('SegmentIndex nearest queries', () => {
  it('revisits multi-bucket segments across repeated queries and independent indexes', () => {
    const index = new SegmentIndex([[{ x: -40, z: 0 }, { x: 40, z: 0 }]], 10);
    const other = new SegmentIndex([[{ x: 0, z: -40 }, { x: 0, z: 40 }]], 10);
    const out = makeHit();
    for (let repeat = 0; repeat < 8; repeat++) {
      for (const coordinate of [-30, -10, 0, 10, 30]) {
        expect(index.nearest(coordinate, 0, Infinity, out)).toBe(out);
        expect(out).toEqual({ distance: 0, line: 0, segment: 0, t: (coordinate + 40) / 80, along: coordinate + 40, side: 1 });
        expect(other.nearest(0, coordinate).distance).toBe(0);
      }
    }
  });

  it('excludes the exact distance bound and finds a segment after bounded misses', () => {
    const index = new SegmentIndex([[{ x: -20, z: 0 }, { x: 20, z: 0 }]], 10);
    const out = makeHit();
    index.nearest(0, 5, 6, out);
    for (const bound of [0, 4, 5]) {
      expect(index.nearest(0, 5, bound, out)).toBe(out);
      expect(out.distance).toBe(Infinity);
      expect(out.line).toBe(-1);
    }
    expect(index.nearest(0, 5, 5.01, out)).toEqual({ distance: 5, line: 0, segment: 0, t: 0.5, along: 20, side: 1 });
    expect(index.nearest(500, -500, 20).distance).toBe(Infinity);
    expect(index.nearest(0, 5).distance).toBe(5);
  });

  it('breaks equal-distance ties by ascending perimeter columns then rows', () => {
    const columns = new SegmentIndex([
      [{ x: 10, z: -1 }, { x: 10, z: 1 }],
      [{ x: -10, z: -1 }, { x: -10, z: 1 }],
    ], 10);
    expect(columns.nearest(0, 0).line).toBe(1);
    const rows = new SegmentIndex([
      [{ x: 1, z: 10 }, { x: 2, z: 10 }],
      [{ x: 1, z: -10 }, { x: 2, z: -10 }],
    ], 10);
    expect(rows.nearest(0, 0).line).toBe(1);
    const sameBucket = new SegmentIndex([
      [{ x: 1, z: 0 }, { x: 1, z: 9 }],
      [{ x: 9, z: 0 }, { x: 9, z: 9 }],
    ], 10);
    expect(sameBucket.nearest(5, 5).line).toBe(0);
  });

  it('projects correctly at negative cell coordinates and exact bucket boundaries', () => {
    const index = new SegmentIndex([[{ x: -20, z: -20 }, { x: -20, z: 20 }]], 10);
    for (const x of [-30, -20, -10, 0]) {
      const hit = index.nearest(x, -10);
      expect(hit).toEqual({ distance: Math.abs(x + 20), line: 0, segment: 0, t: 0.25, along: 10, side: x <= -20 ? 1 : -1 });
    }
  });

  it('uses the shared corner pseudo-normal rather than the winning segment normal', () => {
    const index = new SegmentIndex([[{ x: 0, z: 10 }, { x: 0, z: 0 }, { x: 10, z: 10 }]], 2);
    const hit = index.nearest(1, -2);
    expect(hit.segment).toBe(0);
    expect(hit.t).toBe(1);
    expect(hit.along).toBe(10);
    expect(hit.side).toBe(-1);
    expect(index.signedDistance(1, -2)).toBe(-Math.sqrt(5));
    expect(index.signedDistance(2, 4)).toBeGreaterThan(0);
    expect(index.signedDistance(-2, 4)).toBeLessThan(0);
  });
});
