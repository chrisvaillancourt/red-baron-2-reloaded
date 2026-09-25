/**
 * Historical front lines of the Flanders–Artois–Somme sector, 1915–1918.
 *
 * Each keyframe is six named sections (north → south): Yser coast, Ypres,
 * French Flanders, Artois, Arras–Cambrai, Somme/south. Adjacent sections
 * share their joint. Lines between keyframe dates are interpolated section by
 * section (after arc-length resampling), so quiet sectors stay put while an
 * offensive moves another. Holding periods are expressed by repeating a
 * keyframe at both ends of the quiet interval.
 *
 * Positions are approximate (≈1 km) and drawn from standard campaign maps.
 * Convention: the polyline runs north → south; the allied side is west
 * (right of travel), the central side east.
 */
import { latLonToWorld } from '../core/geo';
import type { Side } from '../core/types';
import { resamplePolyline, SegmentIndex, type Pt } from './segmentIndex';

export interface FrontLine {
  /** Polyline from north (coast) to south, world metres. Allied side is west. */
  points: { x: number; z: number }[];
}

type LL = [number, number];

// --- Sections (without their start point; it is the previous section's end) ---
// Section 1 (North / Yser) includes its own start point.
const N_1915: LL[] = [[51.3, 2.62], [51.15, 2.73], [51.1, 2.78], [51.03, 2.855], [50.97, 2.85], [50.92, 2.865]];
const N_PASSCH: LL[] = [[51.3, 2.62], [51.15, 2.73], [51.1, 2.78], [51.03, 2.855], [50.98, 2.86], [50.95, 2.9], [50.935, 2.945]];
const N_SEP30: LL[] = [[51.3, 2.62], [51.15, 2.73], [51.1, 2.8], [51.05, 2.9], [51.0, 2.97], [50.95, 3.02]];
const N_OCT20: LL[] = [[51.45, 3.45], [51.3, 3.3], [51.2, 3.3], [51.1, 3.4], [51.0, 3.45], [50.9, 3.42]];
const N_NOV11: LL[] = [[51.5, 3.8], [51.3, 3.8], [51.1, 3.8], [50.9, 3.76]];

const Y_1915: LL[] = [[50.88, 2.9], [50.87, 2.935], [50.845, 2.95], [50.825, 2.935], [50.81, 2.895], [50.795, 2.87], [50.77, 2.865], [50.745, 2.875], [50.72, 2.9], [50.69, 2.925]];
const Y_MESS: LL[] = [[50.88, 2.9], [50.87, 2.935], [50.845, 2.95], [50.825, 2.935], [50.81, 2.925], [50.79, 2.92], [50.77, 2.915], [50.75, 2.925], [50.73, 2.935], [50.7, 2.935], [50.69, 2.925]];
const Y_PASSCH: LL[] = [[50.92, 2.975], [50.905, 3.0], [50.9, 3.03], [50.885, 3.03], [50.865, 3.015], [50.85, 3.0], [50.835, 2.975], [50.815, 2.945], [50.79, 2.925], [50.77, 2.915], [50.75, 2.925], [50.73, 2.935], [50.7, 2.935], [50.69, 2.925]];
const Y_LYS: LL[] = [[50.88, 2.9], [50.86, 2.92], [50.84, 2.9], [50.815, 2.86], [50.795, 2.84], [50.785, 2.815], [50.77, 2.78], [50.76, 2.745], [50.745, 2.71], [50.73, 2.69], [50.71, 2.66]];
const Y_SEP30: LL[] = [[50.91, 3.06], [50.87, 3.07], [50.83, 3.05], [50.79, 3.04], [50.75, 2.98], [50.72, 2.93], [50.69, 2.86]];
const Y_OCT20: LL[] = [[50.84, 3.36], [50.78, 3.33], [50.7, 3.28]];
const Y_NOV11: LL[] = [[50.75, 3.75], [50.6, 3.75]];

const F_1915: LL[] = [[50.67, 2.9], [50.64, 2.87], [50.61, 2.83], [50.585, 2.795], [50.56, 2.755], [50.535, 2.765], [50.5, 2.78], [50.465, 2.795]];
const F_LYS: LL[] = [[50.685, 2.63], [50.66, 2.605], [50.64, 2.575], [50.62, 2.56], [50.595, 2.585], [50.575, 2.65], [50.56, 2.7], [50.54, 2.745], [50.53, 2.772], [50.5, 2.785], [50.465, 2.795]];
const F_SEP30: LL[] = [[50.66, 2.84], [50.62, 2.82], [50.58, 2.81], [50.55, 2.82], [50.5, 2.84], [50.465, 2.85]];
const F_OCT20: LL[] = [[50.63, 3.25], [50.55, 3.28], [50.46, 3.32]];
const F_NOV11: LL[] = [[50.45, 3.95]];

const A_1915: LL[] = [[50.44, 2.775], [50.41, 2.74], [50.39, 2.748], [50.37, 2.765], [50.35, 2.777], [50.33, 2.79], [50.3, 2.805], [50.28, 2.8]];
const A_ARRAS: LL[] = [[50.43, 2.8], [50.41, 2.82], [50.38, 2.835], [50.36, 2.845], [50.34, 2.86], [50.32, 2.875], [50.3, 2.89], [50.28, 2.885]];
const A_SEP30: LL[] = [[50.43, 2.86], [50.4, 2.9], [50.36, 2.93], [50.32, 2.98], [50.28, 3.04]];
const A_OCT20: LL[] = [[50.38, 3.36], [50.32, 3.4], [50.25, 3.43]];
const A_NOV11: LL[] = [[50.3, 4.0]];

const AS_1915: LL[] = [[50.26, 2.79], [50.235, 2.75], [50.2, 2.7], [50.16, 2.665], [50.125, 2.645], [50.1, 2.656], [50.085, 2.65], [50.07, 2.668], [50.055, 2.678], [50.03, 2.69], [50.02, 2.69], [49.997, 2.707], [49.99, 2.72]];
const AS_SOMME: LL[] = [[50.26, 2.79], [50.235, 2.75], [50.2, 2.7], [50.16, 2.665], [50.125, 2.645], [50.105, 2.655], [50.09, 2.675], [50.075, 2.71], [50.07, 2.76], [50.065, 2.8], [50.06, 2.845], [50.045, 2.87], [50.02, 2.9], [49.99, 2.925]];
const AS_HIND: LL[] = [[50.265, 2.8], [50.24, 2.79], [50.21, 2.8], [50.19, 2.85], [50.165, 2.9], [50.14, 2.95], [50.12, 3.0], [50.1, 3.04], [50.08, 3.06], [50.05, 3.1], [50.02, 3.125], [49.995, 3.155]];
const AS_ARRAS: LL[] = [[50.27, 2.905], [50.25, 2.885], [50.23, 2.88], [50.2, 2.89], [50.19, 2.905], [50.17, 2.92], [50.14, 2.95], [50.12, 3.0], [50.1, 3.04], [50.08, 3.06], [50.05, 3.1], [50.02, 3.125], [49.995, 3.155]];
const AS_CAMBRAI: LL[] = [[50.27, 2.905], [50.25, 2.885], [50.23, 2.88], [50.2, 2.89], [50.19, 2.905], [50.17, 2.95], [50.16, 3.02], [50.175, 3.07], [50.185, 3.12], [50.175, 3.155], [50.155, 3.17], [50.13, 3.2], [50.115, 3.225], [50.095, 3.22], [50.07, 3.19], [50.05, 3.155], [50.02, 3.14], [49.995, 3.155]];
const AS_DEC: LL[] = [[50.27, 2.905], [50.25, 2.885], [50.23, 2.88], [50.2, 2.89], [50.19, 2.905], [50.17, 2.95], [50.155, 3.03], [50.145, 3.08], [50.14, 3.12], [50.12, 3.145], [50.1, 3.15], [50.08, 3.16], [50.06, 3.14], [50.035, 3.125], [50.01, 3.13], [49.995, 3.155]];
const AS_MICHAEL: LL[] = [[50.27, 2.87], [50.24, 2.84], [50.22, 2.79], [50.2, 2.755], [50.17, 2.73], [50.14, 2.7], [50.12, 2.645], [50.09, 2.635], [50.06, 2.63], [50.03, 2.635], [50.005, 2.635]];
const AS_SEP30: LL[] = [[50.24, 3.1], [50.21, 3.15], [50.18, 3.19], [50.14, 3.21], [50.1, 3.23], [50.05, 3.24], [49.995, 3.225]];
const AS_OCT20: LL[] = [[50.18, 3.45], [50.1, 3.56], [50.0, 3.55]];
const AS_NOV11: LL[] = [[50.1, 4.05], [50.0, 4.08]];

const SO_1915: LL[] = [[49.985, 2.77], [49.985, 2.795], [49.955, 2.815], [49.93, 2.82], [49.9, 2.8], [49.86, 2.785], [49.825, 2.775], [49.76, 2.75], [49.7, 2.755], [49.64, 2.8], [49.58, 2.87], [49.3, 2.95]];
const SO_SOMME: LL[] = [[49.96, 2.9], [49.935, 2.905], [49.91, 2.88], [49.87, 2.86], [49.84, 2.835], [49.825, 2.79], [49.8, 2.77], [49.76, 2.75], [49.7, 2.755], [49.64, 2.8], [49.58, 2.87], [49.3, 2.95]];
const SO_HIND: LL[] = [[49.96, 3.18], [49.92, 3.19], [49.88, 3.21], [49.85, 3.22], [49.8, 3.24], [49.7, 3.3], [49.6, 3.35], [49.3, 3.4]];
const SO_MICHAEL: LL[] = [[49.98, 2.625], [49.955, 2.615], [49.93, 2.6], [49.9, 2.575], [49.875, 2.545], [49.85, 2.53], [49.8, 2.5], [49.77, 2.495], [49.72, 2.52], [49.66, 2.545], [49.64, 2.555], [49.6, 2.6], [49.5, 2.85], [49.3, 2.95]];
const SO_HAMEL: LL[] = [[49.98, 2.625], [49.955, 2.615], [49.93, 2.605], [49.9, 2.6], [49.875, 2.56], [49.85, 2.535], [49.8, 2.5], [49.77, 2.495], [49.72, 2.52], [49.66, 2.545], [49.64, 2.555], [49.6, 2.6], [49.5, 2.85], [49.3, 2.95]];
const SO_SEP30: LL[] = [[49.92, 3.24], [49.87, 3.25], [49.84, 3.26], [49.78, 3.3], [49.7, 3.36], [49.6, 3.42], [49.3, 3.5]];
const SO_OCT20: LL[] = [[49.9, 3.55], [49.8, 3.5], [49.6, 3.5], [49.3, 3.55]];
const SO_NOV11: LL[] = [[49.9, 4.1], [49.6, 4.2], [49.3, 4.3]];

type Sections = [LL[], LL[], LL[], LL[], LL[], LL[]];

interface Keyframe {
  date: string;
  sections: Sections;
  /** 0..1 artillery intensity this line saw (drives cratering). */
  intensity: number;
}

const K1915: Sections = [N_1915, Y_1915, F_1915, A_1915, AS_1915, SO_1915];
const KSOMME: Sections = [N_1915, Y_1915, F_1915, A_1915, AS_SOMME, SO_SOMME];
const KHIND: Sections = [N_1915, Y_1915, F_1915, A_1915, AS_HIND, SO_HIND];
const KARRAS: Sections = [N_1915, Y_1915, F_1915, A_ARRAS, AS_ARRAS, SO_HIND];
const KMESS: Sections = [N_1915, Y_MESS, F_1915, A_ARRAS, AS_ARRAS, SO_HIND];
const KPASSCH: Sections = [N_PASSCH, Y_PASSCH, F_1915, A_ARRAS, AS_ARRAS, SO_HIND];
const KCAMBRAI: Sections = [N_PASSCH, Y_PASSCH, F_1915, A_ARRAS, AS_CAMBRAI, SO_HIND];
const KDEC: Sections = [N_PASSCH, Y_PASSCH, F_1915, A_ARRAS, AS_DEC, SO_HIND];
const KMICHAEL: Sections = [N_PASSCH, Y_PASSCH, F_1915, A_ARRAS, AS_MICHAEL, SO_MICHAEL];
const KLYS: Sections = [N_1915, Y_LYS, F_LYS, A_ARRAS, AS_MICHAEL, SO_MICHAEL];
const KHAMEL: Sections = [N_1915, Y_LYS, F_LYS, A_ARRAS, AS_MICHAEL, SO_HAMEL];
const KSEP30: Sections = [N_SEP30, Y_SEP30, F_SEP30, A_SEP30, AS_SEP30, SO_SEP30];
const KOCT20: Sections = [N_OCT20, Y_OCT20, F_OCT20, A_OCT20, AS_OCT20, SO_OCT20];
const KNOV11: Sections = [N_NOV11, Y_NOV11, F_NOV11, A_NOV11, AS_NOV11, SO_NOV11];

const KEYFRAMES: Keyframe[] = [
  { date: '1915-07-01', sections: K1915, intensity: 0.5 },
  { date: '1916-06-30', sections: K1915, intensity: 0.7 },
  { date: '1916-11-18', sections: KSOMME, intensity: 1.0 },
  { date: '1917-02-25', sections: KSOMME, intensity: 0.8 },
  { date: '1917-03-20', sections: KHIND, intensity: 0.5 },
  { date: '1917-04-08', sections: KHIND, intensity: 0.7 },
  { date: '1917-04-15', sections: KARRAS, intensity: 0.95 },
  { date: '1917-06-06', sections: KARRAS, intensity: 0.8 },
  { date: '1917-06-12', sections: KMESS, intensity: 0.9 },
  { date: '1917-07-30', sections: KMESS, intensity: 0.8 },
  { date: '1917-11-10', sections: KPASSCH, intensity: 1.0 },
  { date: '1917-11-19', sections: KPASSCH, intensity: 0.8 },
  { date: '1917-11-21', sections: KCAMBRAI, intensity: 0.7 },
  { date: '1917-11-29', sections: KCAMBRAI, intensity: 0.7 },
  { date: '1917-12-05', sections: KDEC, intensity: 0.8 },
  { date: '1918-03-20', sections: KDEC, intensity: 0.8 },
  { date: '1918-04-05', sections: KMICHAEL, intensity: 0.55 },
  { date: '1918-04-09', sections: KMICHAEL, intensity: 0.55 },
  { date: '1918-04-30', sections: KLYS, intensity: 0.55 },
  { date: '1918-07-03', sections: KLYS, intensity: 0.6 },
  { date: '1918-07-05', sections: KHAMEL, intensity: 0.6 },
  { date: '1918-08-07', sections: KHAMEL, intensity: 0.6 },
  { date: '1918-09-30', sections: KSEP30, intensity: 0.45 },
  { date: '1918-10-20', sections: KOCT20, intensity: 0.3 },
  { date: '1918-11-11', sections: KNOV11, intensity: 0.1 },
];

export const FRONT_KEYFRAME_DATES: readonly string[] = KEYFRAMES.map((k) => k.date);

const SECTION_SAMPLES = 72;

function toPts(ll: LL[]): Pt[] {
  return ll.map(([lat, lon]) => latLonToWorld(lat, lon));
}

/** Resampled sections per keyframe, each including its start joint. */
const resampledCache = new Map<Sections, Pt[][]>();
function resampledSections(s: Sections): Pt[][] {
  let r = resampledCache.get(s);
  if (r) return r;
  r = [];
  let prevEnd: LL | null = null;
  for (const sec of s) {
    const full: LL[] = prevEnd ? [prevEnd, ...sec] : sec;
    r.push(resamplePolyline(toPts(full), SECTION_SAMPLES));
    prevEnd = full[full.length - 1];
  }
  resampledCache.set(s, r);
  return r;
}

export function dayNumber(date: string): number {
  // Days since epoch, UTC. Accepts 'YYYY-MM-DD'.
  return Math.floor(Date.parse(date.slice(0, 10) + 'T00:00:00Z') / 86_400_000);
}

const KEY_DAYS = KEYFRAMES.map((k) => dayNumber(k.date));

interface BuiltLine {
  line: FrontLine;
  index: SegmentIndex;
}

const lineCache = new Map<string, BuiltLine>();

function extendEnds(pts: Pt[]): Pt[] {
  // Extend both ends far outward so signed distance is well-defined beyond the sector.
  const a = pts[0], b = pts[1];
  const y = pts[pts.length - 1], z = pts[pts.length - 2];
  const ext = (p: Pt, q: Pt): Pt => {
    const dx = p.x - q.x, dz = p.z - q.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / l) * 200_000, z: p.z + (dz / l) * 200_000 };
  };
  return [ext(a, b), ...pts, ext(y, z)];
}

function buildLine(date: string): BuiltLine {
  const d = dayNumber(date);
  let i = 0;
  while (i < KEYFRAMES.length - 1 && KEY_DAYS[i + 1] <= d) i++;
  const k0 = KEYFRAMES[i];
  const k1 = KEYFRAMES[Math.min(i + 1, KEYFRAMES.length - 1)];
  const span = KEY_DAYS[Math.min(i + 1, KEYFRAMES.length - 1)] - KEY_DAYS[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - KEY_DAYS[i]) / span)) : 0;
  const s0 = resampledSections(k0.sections);
  const s1 = resampledSections(k1.sections);
  const points: Pt[] = [];
  for (let s = 0; s < 6; s++) {
    const a = s0[s], b = s1[s];
    for (let j = s === 0 ? 0 : 1; j < SECTION_SAMPLES; j++) {
      points.push({ x: a[j].x + (b[j].x - a[j].x) * f, z: a[j].z + (b[j].z - a[j].z) * f });
    }
  }
  return { line: { points }, index: new SegmentIndex([extendEnds(points)], 3000) };
}

function getLine(date: string): BuiltLine {
  const key = date.slice(0, 10);
  let b = lineCache.get(key);
  if (!b) {
    b = buildLine(key);
    if (lineCache.size > 24) lineCache.delete(lineCache.keys().next().value!);
    lineCache.set(key, b);
  }
  return b;
}

export function frontLineAt(date: string): FrontLine {
  return getLine(date).line;
}

/** Signed distance (m) from the front: negative on the allied (west) side, positive on the central side. */
export function signedDistanceToFront(x: number, z: number, date: string): number {
  // Polyline runs north→south, so right-of-travel is west (allied): flip sign.
  return -getLine(date).index.signedDistance(x, z);
}

export function sideOfFrontAt(x: number, z: number, date: string): Side {
  return signedDistanceToFront(x, z, date) > 0 ? 'central' : 'allied';
}

// ---------------------------------------------------------------------------
// Battlefield history (for cratering): every keyframe line up to `date`.
// ---------------------------------------------------------------------------

// The history is rasterised ("splatted") into a grid once per date: every
// line the front occupied up to that date — keyframes plus lines sampled
// every 10 days through each offensive — leaves its band of craters.

const CR_CELL = 250;
const CR_X0 = -80_000;
const CR_Z0 = -110_000;
const CR_W = Math.ceil(170_000 / CR_CELL);
const CR_H = Math.ceil(200_000 / CR_CELL);
const BAND = 3500;

/** Per date: [intensity grid, freshness grid]. */
const craterCache = new Map<number, [Float32Array, Float32Array]>();
/** Days for battle scars to "age" by a factor e (weeds and grass reclaim old battlefields). */
const SCAR_AGE_DAYS = 200;

function intensityAtDay(day: number): number {
  let i = 0;
  while (i < KEYFRAMES.length - 1 && KEY_DAYS[i + 1] <= day) i++;
  if (i >= KEYFRAMES.length - 1) return KEYFRAMES[i].intensity;
  const span = KEY_DAYS[i + 1] - KEY_DAYS[i];
  const f = span > 0 ? (day - KEY_DAYS[i]) / span : 0;
  return KEYFRAMES[i].intensity + (KEYFRAMES[i + 1].intensity - KEYFRAMES[i].intensity) * f;
}

function historyDays(upTo: number): number[] {
  const days: number[] = [];
  for (let i = 0; i < KEYFRAMES.length; i++) {
    if (KEY_DAYS[i] > upTo) break;
    days.push(KEY_DAYS[i]);
    const next = KEY_DAYS[i + 1];
    if (next !== undefined && KEYFRAMES[i + 1].sections !== KEYFRAMES[i].sections) {
      for (let d = KEY_DAYS[i] + 10; d < next && d <= upTo; d += 10) days.push(d);
    }
  }
  if (days[days.length - 1] !== upTo) days.push(upTo);
  return days;
}

function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function splatLine(grid: Float32Array, fresh: Float32Array, pts: Pt[], intensity: number, recency: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - BAND - CR_X0) / CR_CELL));
    const maxX = Math.min(CR_W - 1, Math.ceil((Math.max(a.x, b.x) + BAND - CR_X0) / CR_CELL));
    const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z) - BAND - CR_Z0) / CR_CELL));
    const maxZ = Math.min(CR_H - 1, Math.ceil((Math.max(a.z, b.z) + BAND - CR_Z0) / CR_CELL));
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    for (let gz = minZ; gz <= maxZ; gz++) {
      const z = CR_Z0 + gz * CR_CELL;
      for (let gx = minX; gx <= maxX; gx++) {
        const x = CR_X0 + gx * CR_CELL;
        let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + abx * t - x, dz = a.z + abz * t - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= BAND) continue;
        const v = bandProfile(d) * intensity;
        const k = gz * CR_W + gx;
        if (v > grid[k]) grid[k] = v;
        const fv = v * recency;
        if (fv > fresh[k]) fresh[k] = fv;
      }
    }
  }
}

function craterGrids(day: number): [Float32Array, Float32Array] {
  let g = craterCache.get(day);
  if (g) return g;
  g = [new Float32Array(CR_W * CR_H), new Float32Array(CR_W * CR_H)];
  for (const d of historyDays(day)) splatLine(g[0], g[1], frontLineAt(dayToIso(d)).points, intensityAtDay(d), Math.exp(-(day - d) / SCAR_AGE_DAYS));
  if (craterCache.size > 3) craterCache.delete(craterCache.keys().next().value!);
  craterCache.set(day, g);
  return g;
}

function gridDay(date: string): number | null {
  const day = dayNumber(date);
  if (day < KEY_DAYS[0]) return null;
  return Math.min(day, KEY_DAYS[KEY_DAYS.length - 1]);
}

/**
 * Crater + freshness grids for `date` (built on first use, ~0.5 s), or null
 * before the war. Exposed so a worker can build them and ship them to the
 * main thread with `installCraterGrids`, keeping the build off the frame loop.
 */
export function craterGridsForDate(date: string): [Float32Array, Float32Array] | null {
  const day = gridDay(date);
  return day === null ? null : craterGrids(day);
}

/** True when `date`'s grids are already cached (or no grid is needed), i.e. queries are cheap. */
export function hasCraterGrids(date: string): boolean {
  const day = gridDay(date);
  return day === null || craterCache.has(day);
}

/** Install grids built elsewhere (a worker) for `date`. */
export function installCraterGrids(date: string, grid: Float32Array, fresh: Float32Array): void {
  const day = gridDay(date);
  if (day === null || grid.length !== CR_W * CR_H || fresh.length !== CR_W * CR_H) return;
  if (craterCache.size > 3) craterCache.delete(craterCache.keys().next().value!);
  craterCache.set(day, [grid, fresh]);
}

function sampleGrid(g: Float32Array, x: number, z: number): number {
  const fx = (x - CR_X0) / CR_CELL;
  const fz = (z - CR_Z0) / CR_CELL;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= CR_W - 1 || iz >= CR_H - 1) return 0;
  const tx = fx - ix, tz = fz - iz;
  const k = iz * CR_W + ix;
  const a = g[k] + (g[k + 1] - g[k]) * tx;
  const b = g[k + CR_W] + (g[k + CR_W + 1] - g[k + CR_W]) * tx;
  return Math.min(1, a + (b - a) * tz);
}

/**
 * 0..1 shell-cratering intensity at (x, z) on `date`: the ground remembers
 * every line fought over up to that date, including ground swept by
 * offensives. Broad band (~3.5 km) with a heavily cratered core around the
 * trench lines themselves. First call per date rasterises the history
 * (~100 ms); subsequent calls are a bilinear lookup.
 */
export function craterIntensityAt(x: number, z: number, date: string): number {
  const day = dayNumber(date);
  if (day < KEY_DAYS[0]) return 0;
  return sampleGrid(craterGrids(Math.min(day, KEY_DAYS[KEY_DAYS.length - 1]))[0], x, z);
}

/**
 * 0..1 how recently the ground at (x, z) was fought over, weighted like
 * craterIntensityAt: 1 = the current line's churned mud, decaying with a
 * ~200-day time constant as weeds and grass reclaim abandoned battlefields
 * (the 1916 Somme is a green-brown cratered wasteland by late 1917).
 */
export function battleFreshnessAt(x: number, z: number, date: string): number {
  const day = dayNumber(date);
  if (day < KEY_DAYS[0]) return 0;
  return sampleGrid(craterGrids(Math.min(day, KEY_DAYS[KEY_DAYS.length - 1]))[1], x, z);
}

function bandProfile(dist: number): number {
  if (dist > 3500) return 0;
  // Core (no-man's-land & front trenches) full; falls off through support lines.
  if (dist < 600) return 1;
  const t = (dist - 600) / 2900;
  return Math.max(0, 1 - t) ** 1.6;
}
