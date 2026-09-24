/**
 * Terrain height field for the sector. Pure, deterministic function of
 * (x, z) — no scene code — shared by physics (ground contact), AI, the
 * campaign (placing things on the ground) and the renderer (mesh vertices).
 *
 * Composition:
 *   1. A hand-authored coarse elevation grid (0.125° cells) capturing the
 *      regional relief: Flanders plain, Flemish hills, the Artois plateau,
 *      the Douai/Lille lowland, Somme and Cambrai chalk uplands.
 *   2. Named features: Vimy ridge/Artois escarpment, Passchendaele–Messines
 *      ridge, Mont Kemmel & the Flemish hills, Notre-Dame-de-Lorette.
 *   3. River valleys carved along RIVERS with a flat floor at a monotonic
 *      downstream elevation (water sits exactly on the floor).
 *   4. The coast: land slopes to beaches, the sea floor drops below 0.
 *   5. Smooth fBm detail (shortest wavelength ~500 m so the mesh at 15–60 m
 *      spacing matches the analytic height within centimetres).
 *   6. Aerodromes flattened to a level field.
 */
import { latLonToWorld } from '../core/geo';
import { AERODROMES } from '../data/aerodromes';
import { COASTLINE, RIVERS } from '../data/geography';
import { SegmentIndex, smoothPolyline, type NearestHit, type Pt } from './segmentIndex';

// ---------------------------------------------------------------------------
// 1. Coarse elevation grid (metres). Rows north → south from 51.25°N in
//    0.125° steps; columns west → east from 1.75°E in 0.125° steps.
// ---------------------------------------------------------------------------
const GRID_LAT0 = 51.25;
const GRID_LON0 = 1.75;
const GRID_STEP = 0.125;
// prettier-ignore
const GRID: number[][] = [
  // 1.75 1.875 2.0 2.125 2.25 2.375 2.5 2.625 2.75 2.875 3.0 3.125 3.25 3.375 3.5 3.625 3.75 3.875 4.0
  [ -20, -20, -20, -20, -18, -15, -12, -10, -8,  -4,   3,   5,   5,   6,   8,   8,  10,  10,  10], // 51.25
  [ -20, -20, -18, -15, -12,  -8,  -3,   2,   3,   4,   8,  12,  12,  10,  10,  10,  10,  12,  12], // 51.125
  [ -10,  10,   5,   3,   2,   3,   5,   5,   6,  10,  20,  25,  20,  15,  12,  12,  12,  15,  15], // 51.0
  [  60,  60,  40,  30,  25,  30,  25,  25,  25,  25,  35,  30,  20,  20,  25,  30,  30,  30,  30], // 50.875
  [ 100, 120,  90,  60,  40,  30,  25,  25,  25,  20,  25,  25,  20,  30,  40,  45,  50,  55,  60], // 50.75
  [ 120, 150, 150, 120,  80,  50,  30,  22,  20,  20,  25,  30,  35,  40,  45,  50,  55,  60,  70], // 50.625
  [ 130, 170, 180, 170, 150, 130, 110,  60,  40,  30,  25,  25,  25,  30,  30,  40,  50,  60,  70], // 50.5
  [ 130, 150, 160, 160, 150, 140, 130, 120, 100,  50,  30,  25,  30,  40,  30,  40,  50,  70,  90], // 50.375
  [ 100, 120, 130, 140, 140, 130, 120, 110,  90,  80,  70,  60,  60,  60,  60,  70,  90, 110, 130], // 50.25
  [  80, 100, 110, 120, 120, 120, 130, 140, 130, 120, 100,  90,  80, 100, 120, 130, 140, 150, 160], // 50.125
  [  60,  80,  90, 100, 100, 100, 110, 120, 130, 130, 120, 120, 110, 120, 140, 150, 160, 170, 180], // 50.0
  [  70,  90, 100, 100,  90,  90,  90,  90,  90,  90,  90,  90, 100, 110, 130, 150, 160, 170, 180], // 49.875
  [ 100, 110, 110, 110, 100, 100, 100,  95,  90,  85,  80,  80,  90, 100, 110, 130, 150, 160, 170], // 49.75
  [ 120, 130, 130, 120, 110, 105, 100,  95,  90,  85,  80,  75,  70,  80, 100, 120, 140, 150, 160], // 49.625
  [ 150, 150, 150, 140, 130, 120, 110, 100,  90,  80,  70,  60,  60,  70,  90, 110, 130, 150, 160], // 49.5
];
const GRID_ROWS = GRID.length;
const GRID_COLS = GRID[0].length;

const M_PER_DEG_LAT = 111_200;
const M_PER_DEG_LON = 111_320 * Math.cos((50.3 * Math.PI) / 180);
const ORIGIN_LAT = 50.3;
const ORIGIN_LON = 2.8;

function gridAt(r: number, c: number): number {
  r = r < 0 ? 0 : r >= GRID_ROWS ? GRID_ROWS - 1 : r;
  c = c < 0 ? 0 : c >= GRID_COLS ? GRID_COLS - 1 : c;
  return GRID[r][c];
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  // Catmull-Rom
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function coarseElevation(x: number, z: number): number {
  const lat = ORIGIN_LAT - z / M_PER_DEG_LAT;
  const lon = ORIGIN_LON + x / M_PER_DEG_LON;
  const fr = (GRID_LAT0 - lat) / GRID_STEP;
  const fc = (lon - GRID_LON0) / GRID_STEP;
  const r = Math.floor(fr);
  const c = Math.floor(fc);
  const tr = fr - r;
  const tc = fc - c;
  const rows: number[] = [];
  for (let i = -1; i <= 2; i++) rows.push(cubic(gridAt(r + i, c - 1), gridAt(r + i, c), gridAt(r + i, c + 1), gridAt(r + i, c + 2), tc));
  return cubic(rows[0], rows[1], rows[2], rows[3], tr);
}

// ---------------------------------------------------------------------------
// 2. Named relief features.
// ---------------------------------------------------------------------------
const ll = (lat: number, lon: number): Pt => latLonToWorld(lat, lon);

interface Hill {
  x: number;
  z: number;
  height: number;
  radius: number;
}
const HILLS: Hill[] = [
  { ...ll(50.782, 2.812), height: 120, radius: 1300 }, // Mont Kemmel (156 m)
  { ...ll(50.787, 2.66), height: 125, radius: 1400 }, // Mont des Cats (164 m)
  { ...ll(50.8, 2.487), height: 135, radius: 1800 }, // Mont Cassel (176 m)
  { ...ll(50.778, 2.74), height: 100, radius: 1200 }, // Mont Noir
  { ...ll(50.782, 2.77), height: 85, radius: 1000 }, // Mont Rouge
  { ...ll(50.405, 2.72), height: 45, radius: 1500 }, // Notre-Dame-de-Lorette spur
  { ...ll(50.09, 2.97), height: 25, radius: 3000 }, // Bapaume–Cambrai plateau swell
];

/** Ridge lines: raised crest with Gaussian cross-profile. */
interface Ridge {
  index: SegmentIndex;
  height: number;
  halfWidth: number;
}
const RIDGES: Ridge[] = [
  // Passchendaele – Broodseinde – Gheluvelt – Messines ridge (~50–80 m above the plain).
  { index: new SegmentIndex([smoothPolyline([ll(50.96, 3.07), ll(50.9, 3.03), ll(50.865, 3.0), ll(50.835, 2.975), ll(50.8, 2.9), ll(50.765, 2.895), ll(50.73, 2.9)])]), height: 32, halfWidth: 1400 },
  // Aubers ridge (low)
  { index: new SegmentIndex([smoothPolyline([ll(50.62, 2.9), ll(50.6, 2.84), ll(50.575, 2.8)])]), height: 12, halfWidth: 1200 },
];

/**
 * Artois escarpment: the plateau edge facing north-east over the Douai plain,
 * sharpest at Vimy ridge. Height added on the south-west (plateau) side.
 */
const ESCARPMENT = new SegmentIndex([
  smoothPolyline([ll(50.6, 2.2), ll(50.54, 2.45), ll(50.47, 2.62), ll(50.42, 2.73), ll(50.38, 2.785), ll(50.35, 2.805), ll(50.32, 2.81), ll(50.28, 2.86)], 2),
]);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// 3. Rivers.
// ---------------------------------------------------------------------------
interface RiverInfo {
  name: string;
  width: number;
  pts: Pt[];
  /** Floor elevation at each point (monotonic non-increasing downstream). */
  floor: number[];
  cum: number[];
  /** Valley half-width (flat floor), and slope width. */
  floorHalf: number;
  slope: number;
  depth: number;
}

const RIVER_PARAMS: Record<string, { floorHalf: number; slope: number; depth: number }> = {
  Somme: { floorHalf: 450, slope: 1500, depth: 40 },
  Ancre: { floorHalf: 150, slope: 900, depth: 35 },
  Avre: { floorHalf: 200, slope: 1000, depth: 30 },
  Scarpe: { floorHalf: 250, slope: 1100, depth: 25 },
  Sensée: { floorHalf: 250, slope: 900, depth: 20 },
  'Escaut (Scheldt)': { floorHalf: 350, slope: 1300, depth: 30 },
  Lys: { floorHalf: 300, slope: 1000, depth: 8 },
  Deûle: { floorHalf: 150, slope: 700, depth: 8 },
  Yser: { floorHalf: 200, slope: 800, depth: 5 },
  'Ypres–Yser Canal': { floorHalf: 30, slope: 120, depth: 4 },
  'Canal du Nord': { floorHalf: 30, slope: 150, depth: 6 },
  Canche: { floorHalf: 250, slope: 1100, depth: 40 },
  Authie: { floorHalf: 220, slope: 1000, depth: 40 },
  Aa: { floorHalf: 200, slope: 900, depth: 20 },
};

let riverInfos: RiverInfo[] | null = null;
let riverIndex: SegmentIndex | null = null;

function preTerrain(x: number, z: number): number {
  // Terrain before rivers/aerodromes (used to derive river floor levels).
  return coarseElevation(x, z) + featureRelief(x, z) + noiseRelief(x, z);
}

function buildRivers(): void {
  riverInfos = RIVERS.map((r) => {
    const pts = smoothPolyline(r.points.map(([lat, lon]) => ll(lat, lon)), 3);
    const p = RIVER_PARAMS[r.name] ?? { floorHalf: 150, slope: 800, depth: 15 };
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    // Floor: local base minus depth, then enforce monotonic downstream, smoothed.
    const raw = pts.map((q) => Math.max(0.5, preTerrain(q.x, q.z) - p.depth));
    const floor: number[] = [];
    let m = Infinity;
    for (const v of raw) floor.push((m = Math.min(m, v)));
    return { name: r.name, width: r.width, pts, floor, cum, ...p };
  });
  riverIndex = new SegmentIndex(riverInfos.map((r) => r.pts), 4000);
}

const riverHit: NearestHit = { distance: 0, line: 0, segment: 0, t: 0, along: 0, side: 1 };

/** Nearest river info: distance, river, floor elevation. Exported for land use/rendering. */
export function riverQuery(x: number, z: number, maxDistance = 4000): { distance: number; river: RiverInfo | null; floor: number } {
  if (!riverIndex) buildRivers();
  const h = riverIndex!.nearest(x, z, maxDistance, riverHit);
  if (h.line < 0) return { distance: Infinity, river: null, floor: 0 };
  const r = riverInfos![h.line];
  const f = r.floor[h.segment] + (r.floor[Math.min(h.segment + 1, r.floor.length - 1)] - r.floor[h.segment]) * h.t;
  return { distance: h.distance, river: r, floor: f };
}

export function riverPolylines(): { name: string; width: number; points: Pt[]; floor: number[] }[] {
  if (!riverInfos) buildRivers();
  return riverInfos!.map((r) => ({ name: r.name, width: r.width, points: r.pts, floor: r.floor }));
}

// ---------------------------------------------------------------------------
// 4. Coast.
// ---------------------------------------------------------------------------
const COAST = new SegmentIndex([smoothPolyline(COASTLINE.map(([lat, lon]) => ll(lat, lon)), 3)], 5000);

/** Signed distance to the coastline: positive over land, negative over sea. */
export function coastDistance(x: number, z: number): number {
  // Coastline runs south → north-east; the sea is on the left of travel, land on the right.
  const d = COAST.signedDistance(x, z, 60_000);
  if (Number.isFinite(d)) return d;
  // Far from the coast: deep inland unless well out west/north in the sea.
  const lon = ORIGIN_LON + x / M_PER_DEG_LON;
  const lat = ORIGIN_LAT - z / M_PER_DEG_LAT;
  return lon < 1.2 || lat > 51.6 ? -60_000 : 60_000;
}

// ---------------------------------------------------------------------------
// 5. Noise.
// ---------------------------------------------------------------------------
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1] (quintic fade). */
export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

export function fbm(x: number, z: number, octaves: number, seed = 0): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * valueNoise(x * f, z * f, seed + i * 17);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}

function noiseRelief(x: number, z: number): number {
  // Amplitudes scale with regional elevation (flat Flanders, rolling chalk).
  const base = coarseElevation(x, z);
  const roll = smoothstep(10, 90, base);
  const n1 = valueNoise(x / 7000, z / 7000, 11) * (4 + 10 * roll);
  const n2 = valueNoise(x / 2600, z / 2600, 23) * (1.5 + 6 * roll);
  const n3 = valueNoise(x / 1100, z / 1100, 37) * (0.6 + 2.5 * roll);
  const n4 = valueNoise(x / 520, z / 520, 41) * (0.3 + 0.9 * roll);
  return n1 + n2 + n3 + n4;
}

function featureRelief(x: number, z: number): number {
  let h = 0;
  for (const hl of HILLS) {
    const dx = x - hl.x;
    const dz = z - hl.z;
    const d2 = (dx * dx + dz * dz) / (hl.radius * hl.radius);
    if (d2 < 9) h += hl.height * Math.exp(-d2);
  }
  for (const r of RIDGES) {
    const d = r.index.nearest(x, z, r.halfWidth * 3).distance;
    if (d !== Infinity) h += r.height * Math.exp(-((d / r.halfWidth) ** 2));
  }
  // Escarpment: +45 m on the plateau side, sharp falloff over ~1.2 km.
  const e = ESCARPMENT.signedDistance(x, z, 12_000);
  if (Number.isFinite(e)) {
    // Polyline runs NW→SE; the plateau (south-west) is on the right of travel (positive).
    h += 45 * smoothstep(-600, 900, e) - 10 * smoothstep(-4000, -500, e) * (1 - smoothstep(-500, 0, e));
  }
  return h;
}

// ---------------------------------------------------------------------------
// 6. Aerodromes.
// ---------------------------------------------------------------------------
const AERO_FLAT = 480;
const AERO_BLEND = 1000;
let aeroLevels: { x: number; z: number; h: number }[] | null = null;

function aerodromeLevels(): { x: number; z: number; h: number }[] {
  if (!aeroLevels) aeroLevels = AERODROMES.map((a) => ({ x: a.x, z: a.z, h: naturalHeight(a.x, a.z) }));
  return aeroLevels;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function naturalHeight(x: number, z: number): number {
  let h = preTerrain(x, z);
  // Rivers
  const rq = riverQuery(x, z, 4000);
  if (rq.river) {
    const r = rq.river;
    const floor = rq.floor;
    if (h > floor) {
      const w = smoothstep(r.floorHalf, r.floorHalf + r.slope, rq.distance);
      h = floor + (h - floor) * w;
    }
    // Channel dip (under the water surface).
    const chan = r.width * 0.5;
    if (rq.distance < chan + 6) h = Math.min(h, floor - 1.8 * (1 - smoothstep(chan * 0.6, chan + 6, rq.distance)));
  }
  // Coast: land within 1.5 km slopes to a low beach; sea floor drops away.
  const cd = coastDistance(x, z);
  if (cd < 1500) {
    const landH = Math.max(h, 0);
    if (cd >= 0) {
      const beach = 1.5 + cd * 0.004;
      h = Math.min(landH, beach + (landH - beach) * smoothstep(100, 1500, cd));
      h = Math.max(h, 0.4 + cd * 0.002);
    } else {
      h = Math.max(-35, -0.5 + cd * 0.01);
    }
  }
  return h;
}

/**
 * Height of the ground above sea level (m) at world (x, z). Sea floor is
 * negative (the sea surface is y = 0).
 */
export function terrainHeightAt(x: number, z: number): number {
  let h = naturalHeight(x, z);
  const levels = aerodromeLevels();
  for (let i = 0; i < levels.length; i++) {
    const a = levels[i];
    const dx = x - a.x;
    const dz = z - a.z;
    if (Math.abs(dx) > AERO_BLEND || Math.abs(dz) > AERO_BLEND) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < AERO_BLEND) {
      const w = smoothstep(AERO_FLAT, AERO_BLEND, d);
      h = a.h + (h - a.h) * w;
    }
  }
  return h;
}

/** Central-difference surface normal (unit, +Y up) at (x, z). */
export function terrainNormalAt(x: number, z: number, eps = 8): { x: number; y: number; z: number } {
  const hx = terrainHeightAt(x + eps, z) - terrainHeightAt(x - eps, z);
  const hz = terrainHeightAt(x, z + eps) - terrainHeightAt(x, z - eps);
  const nx = -hx;
  const ny = 2 * eps;
  const nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return { x: nx / l, y: ny / l, z: nz / l };
}
