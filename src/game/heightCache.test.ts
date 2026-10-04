import { describe, expect, it } from 'vitest';
import { AERODROMES } from '../data/aerodromes';
import { terrainHeightAt } from '../world/terrain';
import { createHeightCache } from './heightCache';

describe('height cache', () => {
  it('tracks the exact terrain closely across the sector and on aerodromes', () => {
    const cache = createHeightCache(terrainHeightAt);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const errs: number[] = [];
    // Clustered samples (tiles are expensive to build; keep the test fast).
    for (let c = 0; c < 6; c++) {
      const cx = -50_000 + rnd() * 110_000;
      const cz = -80_000 + rnd() * 150_000;
      for (let i = 0; i < 150; i++) {
        const x = cx + rnd() * 900;
        const z = cz + rnd() * 900;
        errs.push(Math.abs(cache(x, z) - terrainHeightAt(x, z)));
      }
    }
    for (const a of AERODROMES.slice(0, 6)) {
      for (let i = 0; i < 20; i++) {
        const x = a.x + (rnd() - 0.5) * 400;
        const z = a.z + (rnd() - 0.5) * 400;
        errs.push(Math.abs(cache(x, z) - terrainHeightAt(x, z)));
      }
    }
    errs.sort((a, b) => a - b);
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
    const p99 = errs[Math.floor(errs.length * 0.99)];
    expect(mean).toBeLessThan(0.3);
    expect(p99).toBeLessThan(1.5);
  });

  it('is exact at sample points and continuous across tile edges', () => {
    const cache = createHeightCache(terrainHeightAt);
    expect(cache(0, 0)).toBeCloseTo(terrainHeightAt(0, 0), 3);
    expect(cache(1024, 2048)).toBeCloseTo(terrainHeightAt(1024, 2048), 3);
    const a = cache(1023.999, 500);
    const b = cache(1024.001, 500);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('retains a frequently sampled tile while evicting cold tiles at the bound', () => {
    let calls = 0;
    const cache = createHeightCache((x, z) => { calls++; return x + z; });
    expect(cache(16, 16)).toBe(32);
    for (let tx = 1; tx <= 1200; tx++) {
      cache(tx * 1024 + 16, 16);
      const before = calls;
      expect(cache(16, 16)).toBe(32);
      expect(calls).toBe(before);
      expect(cache.tileCount).toBeLessThanOrEqual(600);
    }
    expect(cache.tileCount).toBe(600);
    const before = calls;
    expect(cache(1040, 16)).toBe(1056);
    expect(calls - before).toBe(33 * 33);
    expect(cache.tileCount).toBe(600);
  });

  it('prefetches inclusive square bounds and refreshes already cached tiles', () => {
    let calls = 0;
    const cache = createHeightCache((x, z) => { calls++; return x + z; });
    cache.prefetch(0, 0, 1024);
    expect(cache.tileCount).toBe(9);
    const prefetched = calls;
    for (const x of [-1000, 16, 1040]) for (const z of [-1000, 16, 1040]) {
      expect(cache(x, z)).toBe(x + z);
    }
    expect(calls).toBe(prefetched);
    for (let tx = 2; tx <= 592; tx++) cache(tx * 1024, 0);
    expect(cache.tileCount).toBe(600);
    cache.prefetch(0, 0, 0);
    expect(calls).toBe(prefetched + 591 * 33 * 33);
    for (let tx = 593; tx <= 1191; tx++) cache(tx * 1024, 0);
    const before = calls;
    expect(cache(16, 16)).toBe(32);
    expect(calls).toBe(before);
    expect(cache(-1000, -1000)).toBe(-2000);
    expect(calls - before).toBe(33 * 33);
    expect(cache.tileCount).toBe(600);
  });

  it('preserves bilinear interpolation and Float32 samples after recycling', () => {
    const cache = createHeightCache((x, z) => x * x + 2 * z * z + 1 / 3);
    const positive = cache(16, 8);
    const negative = cache(-16, -8);
    expect(positive).toBeCloseTo(1024 + 1 / 3, 3);
    expect(negative).toBeCloseTo(1024 + 1 / 3, 3);
    expect(cache(0, 0)).toBe(Math.fround(1 / 3));
    for (let tx = 1; tx <= 601; tx++) cache(tx * 1024, 0);
    expect(cache(16, 8)).toBe(positive);
    expect(cache(-16, -8)).toBe(negative);
    expect(cache(0, 0)).toBe(Math.fround(1 / 3));
  });

  it('keeps completed tiles intact when exact sampling throws', () => {
    let fail = false;
    let calls = 0;
    const cache = createHeightCache((x, z) => {
      calls++;
      if (fail) throw new Error('sampling failed');
      return x + z;
    });
    for (let tx = 0; tx < 600; tx++) cache(tx * 1024, 0);
    fail = true;
    expect(() => cache(600 * 1024, 0)).toThrow('sampling failed');
    const before = calls;
    expect(cache(0, 0)).toBe(0);
    expect(calls).toBe(before);
    expect(cache.tileCount).toBe(600);
    fail = false;
    expect(cache(600 * 1024, 0)).toBe(600 * 1024);
    expect(cache.tileCount).toBe(600);
  });

  it('does not reuse in-progress samples during nested exact callbacks', () => {
    let nested = false;
    let triggered = false;
    let ready = false;
    let calls = 0;
    const cache = createHeightCache((x, z) => {
      calls++;
      if (ready && x === 601 * 1024 && z === 0 && !triggered) {
        triggered = true;
        nested = true;
        // Complete the same tile recursively, then another tile at capacity.
        expect(cache(x + 16, 16)).toBe(x + 32 + 10);
        expect(cache(602 * 1024 + 16, 16)).toBe(602 * 1024 + 32 + 10);
        nested = false;
      }
      return x + z + (nested ? 10 : 0);
    });
    for (let tx = 0; tx <= 600; tx++) cache(tx * 1024, 0);
    ready = true;
    expect(cache(601 * 1024 + 16, 16)).toBe(601 * 1024 + 32);
    const before = calls;
    expect(cache(601 * 1024 + 16, 16)).toBe(601 * 1024 + 32);
    expect(cache(602 * 1024 + 16, 16)).toBe(602 * 1024 + 32 + 10);
    expect(calls).toBe(before);
    expect(cache.tileCount).toBe(600);
  });
});
