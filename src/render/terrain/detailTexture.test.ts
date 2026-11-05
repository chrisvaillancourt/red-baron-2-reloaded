import { describe, expect, it } from 'vitest';
import { detailTextureData } from './detailTexture';

const N = 256;

function channel(data: Uint8Array, c: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < N * N; i++) out.push(data[i * 4 + c] / 255);
  return out;
}

describe('detailTextureData', () => {
  const data = detailTextureData();

  it('centres each detail channel on 0.5, so distant mips shift nothing', () => {
    for (const c of [0, 1]) {
      const v = channel(data, c);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
      expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.5);
    }
  });

  it('tiles: the wrap-around seam is no rougher than the texture inside', () => {
    for (const c of [0, 1]) {
      const v = channel(data, c);
      let inner = 0;
      let seam = 0;
      for (let y = 0; y < N; y++) {
        inner += Math.abs(v[y * N + 100] - v[y * N + 101]);
        seam += Math.abs(v[y * N + N - 1] - v[y * N]);
      }
      expect(seam).toBeLessThan(inner * 1.6);
    }
  });
});
