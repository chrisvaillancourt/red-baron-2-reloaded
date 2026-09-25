/**
 * Where the cumulus clouds are: a deterministic hash over a 3 km cell grid that
 * drifts with the wind, plus the stratus deck of heavy overcast. Pure math, no
 * scene code. The renderer's CloudLayer builds its puffs from these bodies and the
 * AI tests lines of sight against the same density, so a pilot can only hide in a
 * cloud the player can see.
 *
 * The drift is a function of mission time (offset = wind × t), so the renderer and
 * the AI agree on where every cloud is at any moment.
 */
import type { Weather } from '../core/types';

export const CLOUD_CELL = 3000;

/** Density that the in-cloud fog (and the AI's line of sight) treats as opaque over ~80 m. */
const OPAQUE_PATH_M = 80;
const RAY_STEP_M = 100;

export function cloudHash(a: number, b: number, k: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** One cumulus cloud in the drifting frame (world position = frame position + wind offset). */
export interface CloudBody {
  /** Cell and index within the cell (seed for the renderer's puffs). */
  ix: number;
  iz: number;
  c: number;
  cx: number;
  cz: number;
  base: number;
  top: number;
  rx: number;
  rz: number;
  size: number;
}

/** The cumulus bodies in one drifting-frame cell. */
export function cloudBodiesInCell(w: Weather, ix: number, iz: number): CloudBody[] {
  const out: CloudBody[] = [];
  const cover = w.cloudCover;
  if (cover <= 0.02) return out;
  const n = Math.floor(cover * 2.2 + cloudHash(ix, iz, 1));
  const thick = Math.max(200, w.cloudTopM - w.cloudBaseM);
  for (let c = 0; c < n; c++) {
    const cx = (ix + 0.1 + 0.8 * cloudHash(ix, iz, 10 + c)) * CLOUD_CELL;
    const cz = (iz + 0.1 + 0.8 * cloudHash(ix, iz, 20 + c)) * CLOUD_CELL;
    const size = (500 + 1300 * cloudHash(ix, iz, 30 + c)) * (0.7 + cover * 0.6);
    const rx = size * (0.8 + 0.4 * cloudHash(ix, iz, 40 + c));
    const rz = size * (0.8 + 0.4 * cloudHash(ix, iz, 50 + c));
    const base = w.cloudBaseM + (cloudHash(ix, iz, 60 + c) - 0.5) * 120;
    const top = base + thick * (0.35 + 0.65 * cloudHash(ix, iz, 70 + c)) * Math.min(1, size / 1200 + 0.3);
    out.push({ ix, iz, c, cx, cz, base, top, rx, rz, size });
  }
  return out;
}

/** Wind drift of the cloud frame at mission time t (x, z metres). */
export function cloudDrift(w: Weather, t: number): { x: number; z: number } {
  return { x: w.wind[0] * t, z: w.wind[2] * t };
}

/** Cached cloud field for one weather; answers density and line-of-sight queries. */
export class CloudField {
  private readonly cells = new Map<number, CloudBody[]>();

  constructor(readonly weather: Weather) {}

  /** True when there are no clouds at all (every query returns 0 / 1). */
  get clear(): boolean {
    return this.weather.cloudCover <= 0.02;
  }

  bodiesInCell(ix: number, iz: number): CloudBody[] {
    const key = (ix + 32768) * 65536 + (iz + 32768);
    let list = this.cells.get(key);
    if (!list) {
      if (this.cells.size > 1500) this.cells.clear();
      list = cloudBodiesInCell(this.weather, ix, iz);
      this.cells.set(key, list);
    }
    return list;
  }

  /** Altitude band (m) outside which density is always 0. */
  band(): { lo: number; hi: number } {
    const w = this.weather;
    return { lo: w.cloudBaseM - 110, hi: w.cloudTopM + 100 };
  }

  /** 0..1 cloud density at a world position at mission time t. */
  densityAt(x: number, y: number, z: number, t: number): number {
    const w = this.weather;
    if (w.cloudCover > 0.6 && y > w.cloudBaseM + 40 && y < w.cloudBaseM + (w.cloudTopM - w.cloudBaseM) * 0.6) {
      return Math.min(1, (w.cloudCover - 0.6) * 3);
    }
    if (w.cloudCover <= 0.02 || y < w.cloudBaseM - 50 || y > w.cloudTopM + 100) return 0;
    const lx = x - w.wind[0] * t;
    const lz = z - w.wind[2] * t;
    const ix = Math.floor(lx / CLOUD_CELL);
    const iz = Math.floor(lz / CLOUD_CELL);
    let best = 0;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const c of this.bodiesInCell(ix + i, iz + j)) {
          const dx = (lx - c.cx) / (c.rx * 0.75);
          const dz = (lz - c.cz) / (c.rz * 0.75);
          const dy = (y - (c.base + c.top) / 2) / Math.max(80, (c.top - c.base) / 2);
          const d2 = dx * dx + dz * dz + dy * dy;
          if (d2 < 1) best = Math.max(best, 1 - d2);
        }
    return Math.min(1, best * 1.5);
  }

  /**
   * Centre of the nearest cloud a pilot at (x, y, z) could hide in, within `maxR`
   * metres horizontally, at mission time t: a cumulus body's core, or, under a solid
   * overcast, the deck straight above or below. Null when there is none in reach.
   */
  nearestCloud(x: number, _y: number, z: number, t: number, maxR: number): { x: number; y: number; z: number; radius: number } | null {
    const w = this.weather;
    if (this.clear) return null;
    if (w.cloudCover > 0.6) return { x, y: w.cloudBaseM + (w.cloudTopM - w.cloudBaseM) * 0.3, z, radius: Infinity };
    const lx = x - w.wind[0] * t;
    const lz = z - w.wind[2] * t;
    const ix = Math.floor(lx / CLOUD_CELL);
    const iz = Math.floor(lz / CLOUD_CELL);
    const rc = Math.ceil(maxR / CLOUD_CELL) + 1;
    let best: CloudBody | null = null;
    let bestD = Infinity;
    for (let i = -rc; i <= rc; i++)
      for (let j = -rc; j <= rc; j++)
        for (const c of this.bodiesInCell(ix + i, iz + j)) {
          // Too thin to hide in.
          if (c.top - c.base < 250 || Math.min(c.rx, c.rz) < 450) continue;
          const d = Math.hypot(c.cx - lx, c.cz - lz);
          if (d < bestD && d <= maxR) {
            bestD = d;
            best = c;
          }
        }
    if (!best) return null;
    return { x: best.cx + w.wind[0] * t, y: (best.base + best.top) / 2, z: best.cz + w.wind[2] * t, radius: Math.min(best.rx, best.rz) * 0.75 };
  }

  /**
   * Fraction of light that gets through the cloud between two points (1 = clear,
   * → 0 through a cloud core). Beer–Lambert over the sampled density, with ~80 m of
   * full density treated as one optical depth (the renderer's in-cloud fog).
   */
  transmittance(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): number {
    if (this.clear) return 1;
    const { lo, hi } = this.band();
    // Clip the segment to the cloud band.
    let s0 = 0;
    let s1 = 1;
    const dy = by - ay;
    if (Math.abs(dy) < 1e-6) {
      if (ay < lo || ay > hi) return 1;
    } else {
      const u0 = (lo - ay) / dy;
      const u1 = (hi - ay) / dy;
      s0 = Math.max(0, Math.min(u0, u1));
      s1 = Math.min(1, Math.max(u0, u1));
      if (s1 <= s0) return 1;
    }
    const len = Math.hypot(bx - ax, dy, bz - az) * (s1 - s0);
    if (len < 1) return 1;
    const n = Math.max(1, Math.ceil(len / RAY_STEP_M));
    const ds = len / n;
    let depth = 0;
    for (let k = 0; k < n; k++) {
      const s = s0 + ((k + 0.5) / n) * (s1 - s0);
      depth += this.densityAt(ax + (bx - ax) * s, ay + dy * s, az + (bz - az) * s, t) * ds;
      if (depth > OPAQUE_PATH_M * 5) return 0;
    }
    return Math.exp(-depth / OPAQUE_PATH_M);
  }
}
