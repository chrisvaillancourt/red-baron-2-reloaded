/**
 * Tileable ground-detail texture, generated at startup (no image asset).
 *
 * R: fine grain (soil crumbs, grass blades) — sampled at metre scale.
 * G: clumps (tussocks, crop patches, damp hollows) — sampled at tens of metres.
 *
 * Each channel is normalised to a mean of 0.5, so mipmapping fades the detail out
 * with distance on its own: far pixels sample the average and shift nothing. The
 * terrain shader uses it as a luminance modulation and a small bump.
 */
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

const N = 256;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x & (N - 1), 0x27d4eb2d) ^ Math.imul(y & (N - 1), 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise on an N-periodic lattice of cell size `cell` (must divide N). */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const period = N / cell;
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  const h = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed + cell * 7);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function normalise(src: Float32Array): Float32Array {
  let mean = 0;
  for (const v of src) mean += v;
  mean /= src.length;
  let dev = 0;
  for (const v of src) dev = Math.max(dev, Math.abs(v - mean));
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = 0.5 + ((src[i] - mean) / (dev || 1)) * 0.5;
  return out;
}

/** The raw RGBA bytes (exported for tests). */
export function detailTextureData(): Uint8Array {
  const fine = new Float32Array(N * N);
  const clump = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // Fine: high-frequency grain with a few sharper specks.
      const g = valueNoise(x, y, 2, 1) * 0.45 + valueNoise(x, y, 4, 2) * 0.3 + valueNoise(x, y, 8, 3) * 0.25;
      const speck = hash(x, y, 9) > 0.93 ? 0.35 : 0;
      fine[i] = g - speck;
      // Clumps: blotchy, rotated octaves so they don't look like a grid.
      clump[i] = valueNoise(x, y, 16, 4) * 0.5 + valueNoise(x + 37, y + 11, 32, 5) * 0.3 + valueNoise(x, y, 8, 6) * 0.2;
    }
  const r = normalise(fine);
  const gch = normalise(clump);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = Math.round(Math.min(1, Math.max(0, r[i])) * 255);
    out[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, gch[i])) * 255);
    out[i * 4 + 2] = 128;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function createDetailTexture(anisotropy: number): DataTexture {
  const t = new DataTexture(detailTextureData(), N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}
