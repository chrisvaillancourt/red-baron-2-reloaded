/**
 * Tree placement for one 500 m cell: woodland, lone field trees, poplar rows
 * along roads, willows by rivers, and shattered stumps in the battle zone.
 * Pure (three math only), so it runs in a web worker (treeWorker.ts) — a
 * forested cell costs tens of milliseconds, far too much for the main thread.
 */
import { Color, Matrix4, Quaternion, Vector3 } from 'three';
import { craterIntensityAt } from '../world/frontline';
import { aerodromeClearance, forestDensityAt, townDensityAt } from '../world/landuse';
import { roadNetwork } from '../world/roads';
import { coastDistance, riverQuery, terrainHeightAt, valueNoise } from '../world/terrain';

export const CELL = 500;
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export const KIND_BROAD = 0;
export const KIND_POPLAR = 1;
export const KIND_STUMP = 2;
export const KINDS = 3;

export interface CellData {
  key: string;
  cx: number;
  cz: number;
  // Per kind: packed matrices (16 floats) and colours (3 floats)
  kinds: { m: Float32Array; c: Float32Array; n: number }[];
}

export interface TreeCellRequest {
  id: number;
  ix: number;
  iz: number;
  date: string;
  season: Season;
  density: number;
}

const STUMP_TINT = new Color(1.25, 1.2, 1.15);

export const SEASON_LEAF: Record<Season, string[]> = {
  spring: ['#5f8a3a', '#6d9442', '#557f35', '#79a04a'],
  summer: ['#3f5f2b', '#4a6a30', '#355426', '#56753a'],
  autumn: ['#77683a', '#85613c', '#66683a', '#6f5433', '#56602f'],
  // Bare winter crowns: twig-grey, drawn see-through via alpha-to-coverage (TreeLayer.bareUniform).
  winter: ['#5d5550', '#655b52', '#554e49', '#6b6158'],
};

export function hash(x: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

type Seg = { ax: number; az: number; bx: number; bz: number };
let roadCells: Map<string, Seg[]> | null = null;

function roadsIn(key: string): Seg[] {
  if (!roadCells) {
    roadCells = new Map();
    for (const r of roadNetwork()) {
      if (!r.major && hash(r.points[0].x, r.points[0].z, 3) > 0.5) continue; // only some lanes lined
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.ceil(len / (CELL / 2));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const k = `${Math.floor((a.x + (b.x - a.x) * t) / CELL)},${Math.floor((a.z + (b.z - a.z) * t) / CELL)}`;
          let arr = roadCells.get(k);
          if (!arr) roadCells.set(k, (arr = []));
          const last = arr[arr.length - 1];
          if (!last || last.ax !== a.x || last.bx !== b.x) arr.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        }
      }
    }
  }
  return roadCells.get(key) ?? [];
}

export function buildTreeCell(ix: number, iz: number, date: string, season: Season, density: number): CellData {
  const key = `${ix},${iz}`;
  const x0 = ix * CELL;
  const z0 = iz * CELL;
  const lists: number[][] = [[], [], []];
  const cols: number[][] = [[], [], []];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const s = new Vector3();
  const leaf = SEASON_LEAF[season].map((c) => new Color(c));
  const push = (kind: number, x: number, z: number, scale: number, rot: number, color: Color) => {
    q.setFromAxisAngle(up, rot);
    m.compose(p.set(x, terrainHeightAt(x, z) - 0.3, z), q, s.set(scale, scale * (0.85 + 0.3 * hash(x, z, 9)), scale));
    for (let i = 0; i < 16; i++) lists[kind].push(m.elements[i]);
    cols[kind].push(color.r, color.g, color.b);
  };
  // Coarse pre-pass: most cells hold no woodland, so skip the (costly) per-tree
  // forest density there. Woods vary on a >400 m scale; a 7x7 probe catches them.
  let forestMax = 0;
  for (let j = 0; j <= 6 && forestMax < 0.25; j++)
    for (let i = 0; i <= 6; i++) forestMax = Math.max(forestMax, forestDensityAt(x0 + (i / 6) * CELL, z0 + (j / 6) * CELL));
  const hasForest = forestMax >= 0.25;
  const spacing = 9.5 / Math.sqrt(density);
  const n = Math.floor(CELL / spacing);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const hx = hash(ix * 97 + i, iz * 89 + j, 1);
      const hz = hash(ix * 97 + i, iz * 89 + j, 2);
      const x = x0 + (i + hx) * spacing;
      const z = z0 + (j + hz) * spacing;
      const lone = hash(x, z, 11) < 0.004 * density;
      const stumpy = hash(x, z, 12) < 0.004;
      if (!hasForest && !lone && !stumpy) continue;
      const f = hasForest ? forestDensityAt(x, z) : 0;
      const noise = valueNoise(x / 40, z / 40, 5) * 0.06;
      const crater = craterIntensityAt(x, z, date);
      if (f + noise > 0.5) {
        if (crater > 0.55) {
          if (hash(x, z, 4) < 0.22) push(KIND_STUMP, x, z, 1.2 + 2.5 * hash(x, z, 5), hash(x, z, 6) * 6.28, STUMP_TINT);
          continue;
        }
        const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.8 + 0.4 * hash(x, z, 8));
        push(KIND_BROAD, x, z, 0.9 + 0.8 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
      } else if (lone && crater < 0.4) {
        // Lone field / hedgerow trees.
        if (townDensityAt(x, z) > 0.4 || aerodromeClearance(x, z) < 1) continue;
        if (coastDistance(x, z) < 200) continue;
        const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.85 + 0.3 * hash(x, z, 8));
        push(KIND_BROAD, x, z, 0.8 + 0.7 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
      } else if (crater > 0.6 && stumpy) {
        push(KIND_STUMP, x, z, 1 + 1.5 * hash(x, z, 5), hash(x, z, 6) * 6.28, STUMP_TINT);
      }
    }
  // Poplars along roads (and some river banks).
  for (const seg of roadsIn(key)) {
    const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
    const dx = (seg.bx - seg.ax) / len, dz = (seg.bz - seg.az) / len;
    const spacingP = 14;
    for (let d = 0; d < len; d += spacingP) {
      const cx = seg.ax + dx * d, cz = seg.az + dz * d;
      if (cx < x0 || cx >= x0 + CELL || cz < z0 || cz >= z0 + CELL) continue;
      if (townDensityAt(cx, cz) > 0.3) continue;
      const crater = craterIntensityAt(cx, cz, date);
      for (const sd of [-1, 1]) {
        const x = cx - dz * 9 * sd, z = cz + dx * 9 * sd;
        if (hash(x, z, 13) < 0.15) continue;
        if (crater > 0.5) {
          if (hash(x, z, 14) < 0.3) push(KIND_STUMP, x, z, 2 + 3 * hash(x, z, 5), 0, STUMP_TINT);
          continue;
        }
        const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.85 + 0.25 * hash(x, z, 8));
        push(KIND_POPLAR, x, z, 0.85 + 0.35 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
      }
    }
  }
  // Willows along rivers near the water.
  const rq = riverQuery(x0 + CELL / 2, z0 + CELL / 2, CELL);
  if (rq.river && rq.distance < CELL) {
    for (let k = 0; k < 40; k++) {
      const x = x0 + hash(ix, iz, 20 + k) * CELL;
      const z = z0 + hash(ix, iz, 60 + k) * CELL;
      const r2 = riverQuery(x, z, 80);
      if (!r2.river || r2.distance < r2.river.width * 0.6 + 3 || r2.distance > r2.river.width * 0.6 + 25) continue;
      if (craterIntensityAt(x, z, date) > 0.5) continue;
      const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(1.05);
      push(KIND_BROAD, x, z, 0.8 + 0.4 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
    }
  }
  return {
    key,
    cx: x0 + CELL / 2,
    cz: z0 + CELL / 2,
    kinds: lists.map((l, k) => ({ m: new Float32Array(l), c: new Float32Array(cols[k]), n: l.length / 16 })),
  };
}
