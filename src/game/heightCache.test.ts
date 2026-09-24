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
});
