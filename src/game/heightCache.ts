/**
 * Tiled, bilinearly-interpolated cache over the analytic terrain height
 * function. The world module's terrainHeightAt is exact but costs ~20 µs per
 * call; the sim, AI, combat (bullets) and atmosphere query it thousands of
 * times per simulated second. Sampling it once per CELL metres and
 * interpolating makes the whole flight loop several times faster, with sub-metre
 * error on this sector's gentle relief (see heightCache.test.ts).
 */

export interface HeightCache {
  (x: number, z: number): number;
  /** Build the tiles covering a square of `radius` metres around (x, z). */
  prefetch(x: number, z: number, radius: number): void;
  readonly tileCount: number;
}

const CELL = 32; // metres between samples
const TILE_CELLS = 32; // cells per tile side (1024 m tiles)
const TILE = CELL * TILE_CELLS;
const SIDE = TILE_CELLS + 1;
const MAX_TILES = 600; // ~2.6 MB of Float32 samples

interface TileEntry {
  key: number;
  samples: Float32Array;
  older: TileEntry | undefined;
  newer: TileEntry | undefined;
}

export function createHeightCache(exact: (x: number, z: number) => number): HeightCache {
  const tiles = new Map<number, TileEntry>();
  let oldest: TileEntry | undefined;
  let newest: TileEntry | undefined;
  // One detached entry lets misses finish sampling before evicting a live tile.
  let spare: TileEntry | undefined;

  function key(tx: number, tz: number): number {
    // Sector is well within ±2^15 tiles in each axis.
    return (tx + 32768) * 65536 + (tz + 32768);
  }

  function unlink(t: TileEntry): void {
    if (t.older) t.older.newer = t.newer;
    else oldest = t.newer;
    if (t.newer) t.newer.older = t.older;
    else newest = t.older;
  }

  function append(t: TileEntry): void {
    t.older = newest;
    t.newer = undefined;
    if (newest) newest.newer = t;
    else oldest = t;
    newest = t;
  }

  function build(tx: number, tz: number, k: number): Float32Array {
    const t = spare ?? { key: k, samples: new Float32Array(SIDE * SIDE), older: undefined, newer: undefined };
    // Exact is a callback: nested builds must never share the in-progress buffer.
    spare = undefined;
    t.key = k;
    const a = t.samples;
    const x0 = tx * TILE;
    const z0 = tz * TILE;
    for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) a[j * SIDE + i] = exact(x0 + i * CELL, z0 + j * CELL);

    // Publish only completed samples. A throwing callback leaves cached tiles intact.
    // A nested call may have built this key or changed which tile is least recent.
    const replaced = tiles.get(k);
    const evicted = replaced ?? (tiles.size >= MAX_TILES ? oldest : undefined);
    if (evicted) {
      unlink(evicted);
      tiles.delete(evicted.key);
      evicted.older = undefined;
      evicted.newer = undefined;
      spare = evicted;
    }
    tiles.set(k, t);
    append(t);
    return a;
  }

  function tile(tx: number, tz: number): Float32Array {
    const k = key(tx, tz);
    // Nearby samples usually stay in the newest tile; skip its Map lookup too.
    if (newest && newest.key === k) return newest.samples;
    const t = tiles.get(k);
    if (!t) return build(tx, tz, k);
    if (t !== newest) {
      unlink(t);
      append(t);
    }
    return t.samples;
  }

  const fn = ((x: number, z: number): number => {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    const t = tile(tx, tz);
    const fx = (x - tx * TILE) / CELL;
    const fz = (z - tz * TILE) / CELL;
    const i = Math.min(TILE_CELLS - 1, Math.floor(fx));
    const j = Math.min(TILE_CELLS - 1, Math.floor(fz));
    const u = fx - i;
    const v = fz - j;
    const r = j * SIDE + i;
    const h00 = t[r];
    const h10 = t[r + 1];
    const h01 = t[r + SIDE];
    const h11 = t[r + SIDE + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }) as HeightCache;

  fn.prefetch = (x: number, z: number, radius: number) => {
    const a = Math.floor((x - radius) / TILE);
    const b = Math.floor((x + radius) / TILE);
    const c = Math.floor((z - radius) / TILE);
    const d = Math.floor((z + radius) / TILE);
    for (let tx = a; tx <= b; tx++) for (let tz = c; tz <= d; tz++) tile(tx, tz);
  };
  Object.defineProperty(fn, 'tileCount', { get: () => tiles.size });
  return fn;
}
