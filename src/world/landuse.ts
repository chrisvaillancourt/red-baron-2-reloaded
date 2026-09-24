/**
 * Land use / surface classification. Pure functions shared by the renderer
 * (terrain shading, tree & house placement), the sim (water landings) and the
 * campaign (placing targets on sensible ground).
 */
import { latLonToWorld } from '../core/geo';
import { AERODROMES } from '../data/aerodromes';
import { FORESTS, TOWNS, type Town } from '../data/geography';
import { craterIntensityAt, signedDistanceToFront } from './frontline';
import { pointInPolygon, type Pt } from './segmentIndex';
import { coastDistance, fbm, riverQuery, terrainHeightAt, valueNoise } from './terrain';

export type LandUse = 'field' | 'pasture' | 'forest' | 'town' | 'water' | 'trench-zone' | 'shell-cratered' | 'beach' | 'sea';

export interface TownWorld extends Town {
  x: number;
  z: number;
  /** Built-up radius, m. */
  radius: number;
}

const TOWN_RADIUS: Record<Town['size'], number> = { city: 1700, town: 750, village: 260 };

export const TOWNS_WORLD: readonly TownWorld[] = TOWNS.map((t) => ({ ...t, ...latLonToWorld(t.lat, t.lon), radius: TOWN_RADIUS[t.size] }));

const FOREST_POLYS: { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number }[] = FORESTS.map((f) => {
  const pts = f.points.map(([lat, lon]) => latLonToWorld(lat, lon));
  return {
    pts,
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
});

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 0..1 built-up density (1 in a town centre). */
const TOWN_CELL = 4000;
const TOWN_BUCKETS = new Map<number, TownWorld[]>();
for (const t of TOWNS_WORLD) {
  const r = t.radius * 1.4;
  for (let cx = Math.floor((t.x - r) / TOWN_CELL); cx <= Math.floor((t.x + r) / TOWN_CELL); cx++)
    for (let cz = Math.floor((t.z - r) / TOWN_CELL); cz <= Math.floor((t.z + r) / TOWN_CELL); cz++) {
      const k = (cx + 1000) * 4096 + (cz + 1000);
      let b = TOWN_BUCKETS.get(k);
      if (!b) TOWN_BUCKETS.set(k, (b = []));
      b.push(t);
    }
}

export function townDensityAt(x: number, z: number): number {
  let best = 0;
  const bucket = TOWN_BUCKETS.get((Math.floor(x / TOWN_CELL) + 1000) * 4096 + (Math.floor(z / TOWN_CELL) + 1000));
  if (!bucket) return 0;
  for (let i = 0; i < bucket.length; i++) {
    const t = bucket[i];
    const dx = x - t.x;
    const dz = z - t.z;
    const r = t.radius;
    if (dx > r * 1.4 || dx < -r * 1.4 || dz > r * 1.4 || dz < -r * 1.4) continue;
    // Irregular edge: modulate radius with noise.
    const rr = r * (0.85 + 0.3 * valueNoise(x / 350, z / 350, 91));
    const d = Math.sqrt(dx * dx + dz * dz);
    best = Math.max(best, 1 - smoothstep(rr * 0.35, rr, d));
  }
  return best;
}

/** Nearest town (world) and distance. */
export function nearestTown(x: number, z: number, filter?: (t: TownWorld) => boolean): { town: TownWorld; distance: number } {
  let best = TOWNS_WORLD[0];
  let bd = Infinity;
  for (const t of TOWNS_WORLD) {
    if (filter && !filter(t)) continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return { town: best, distance: bd };
}

/** 0..1 woodland density (date-independent; see craterIntensityAt for war damage). */
export function forestDensityAt(x: number, z: number): number {
  let poly = 0;
  for (const f of FOREST_POLYS) {
    if (x < f.minX - 300 || x > f.maxX + 300 || z < f.minZ - 300 || z > f.maxZ + 300) continue;
    const wx = x + 220 * valueNoise(x / 700, z / 700, 601);
    const wz = z + 220 * valueNoise(x / 700, z / 700, 607);
    if (pointInPolygon(wx, wz, f.pts)) {
      poly = 1;
      break;
    }
  }
  // Scattered copses and woods: ~8% coverage, blobby at 1–3 km scale.
  const n = fbm(x / 2600, z / 2600, 4, 501) + 0.25 * valueNoise(x / 420, z / 420, 503);
  const woods = smoothstep(0.23, 0.3, n);
  // Fewer woods in the flat, intensively farmed Flanders plain and near towns.
  const town = townDensityAt(x, z);
  // Aerodromes are open ground (every historical field, whatever the date).
  let open = 1;
  for (const a of AERODROMES) {
    const dx = x - a.x, dz = z - a.z;
    if (dx > 900 || dx < -900 || dz > 900 || dz < -900) continue;
    open = Math.min(open, smoothstep(650, 900, Math.sqrt(dx * dx + dz * dz)));
  }
  return Math.max(poly, woods) * (1 - town) * open;
}

export interface LandWeights {
  forest: number;
  town: number;
  crater: number;
  /** River/sea water coverage 0..1 */
  water: number;
  /** Signed distance to the current front, m (+ central, − allied). */
  front: number;
  height: number;
}

/** All land-use weights at a point for the given date (used per terrain vertex). */
export function landWeights(x: number, z: number, date: string, out?: LandWeights): LandWeights {
  const w = out ?? { forest: 0, town: 0, crater: 0, water: 0, front: 0, height: 0 };
  w.height = terrainHeightAt(x, z);
  w.front = signedDistanceToFront(x, z, date);
  w.crater = Math.abs(w.front) < 40_000 ? craterIntensityAt(x, z, date) : 0;
  w.town = townDensityAt(x, z);
  w.forest = forestDensityAt(x, z);
  const rq = riverQuery(x, z, 200);
  let water = 0;
  if (rq.river) water = 1 - smoothstep(rq.river.width * 0.45, rq.river.width * 0.55, rq.distance);
  if (coastDistance(x, z) < 0) water = 1;
  w.water = water;
  return w;
}

/** Surface classification at a point on a date. */
export function landUseAt(x: number, z: number, date: string): LandUse {
  const cd = coastDistance(x, z);
  if (cd < 0) return 'sea';
  if (cd < 180) return 'beach';
  const rq = riverQuery(x, z, 200);
  if (rq.river && rq.distance < rq.river.width * 0.5) return 'water';
  const front = Math.abs(signedDistanceToFront(x, z, date));
  if (front < 700) return 'trench-zone';
  const crater = craterIntensityAt(x, z, date);
  if (crater > 0.45) return 'shell-cratered';
  if (townDensityAt(x, z) > 0.5) return 'town';
  if (forestDensityAt(x, z) > 0.5) return 'forest';
  // Pasture vs arable by noise (more pasture in the wetter Flanders north).
  const flanders = smoothstep(50.55, 50.75, 50.3 - z / 111_200);
  return valueNoise(x / 900, z / 900, 707) + flanders * 0.4 > 0.25 ? 'pasture' : 'field';
}
