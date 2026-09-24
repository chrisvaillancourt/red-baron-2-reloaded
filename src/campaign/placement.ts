/**
 * Geometry helpers for placing mission elements relative to the front line.
 * Only uses the exported src/world front-line API so it keeps working when
 * the world agent replaces the stub data.
 */
import { SECTOR_BOUNDS, headingFromVector } from '../core/geo';
import type { Side } from '../core/types';
import { TOWNS, type Town } from '../data/geography';
import { latLonToWorld } from '../core/geo';
import { frontLineAt, sideOfFrontAt } from '../world/frontline';

export interface XZ {
  x: number;
  z: number;
}

export interface FrontPoint extends XZ {
  /** Unit vector along the line (roughly north -> south). */
  tangent: XZ;
  /** Unit vector pointing into central-held ground (roughly east). */
  towardCentral: XZ;
}

const MARGIN = 6000;

export function clampToSector(p: XZ, margin = MARGIN): XZ {
  return {
    x: Math.min(SECTOR_BOUNDS.maxX - margin, Math.max(SECTOR_BOUNDS.minX + margin, p.x)),
    z: Math.min(SECTOR_BOUNDS.maxZ - margin, Math.max(SECTOR_BOUNDS.minZ + margin, p.z)),
  };
}

export function inSector(p: XZ): boolean {
  return p.x >= SECTOR_BOUNDS.minX && p.x <= SECTOR_BOUNDS.maxX && p.z >= SECTOR_BOUNDS.minZ && p.z <= SECTOR_BOUNDS.maxZ;
}

export function dist(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function add(a: XZ, dir: XZ, d: number): XZ {
  return { x: a.x + dir.x * d, z: a.z + dir.z * d };
}

export function heading(from: XZ, to: XZ): number {
  return headingFromVector(to.x - from.x, to.z - from.z);
}

/** Closest point on the front polyline to p, with local orientation. */
export function nearestFrontPoint(p: XZ, date: string): FrontPoint {
  const pts = frontLineAt(date).points;
  let best: FrontPoint | null = null;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
    const q = { x: a.x + abx * t, z: a.z + abz * t };
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      const len = Math.sqrt(len2);
      best = { ...q, tangent: { x: abx / len, z: abz / len }, towardCentral: { x: abz / len, z: -abx / len } };
    }
  }
  if (!best) throw new Error('Front line has no segments');
  return best;
}

/** Direction from friendly into enemy ground for `side`. */
export function enemyDirection(fp: FrontPoint, side: Side): XZ {
  return side === 'allied' ? fp.towardCentral : { x: -fp.towardCentral.x, z: -fp.towardCentral.z };
}

/**
 * A point `distance` metres into `side`'s ground from front point fp, verified
 * against sideOfFrontAt (the line can bend, so we push further if needed).
 */
export function pointOnSide(fp: FrontPoint, side: Side, distance: number, date: string, lateral = 0): XZ {
  const into = side === 'central' ? fp.towardCentral : { x: -fp.towardCentral.x, z: -fp.towardCentral.z };
  let d = Math.max(300, distance);
  for (let i = 0; i < 8; i++) {
    const p = clampToSector(add(add(fp, fp.tangent, lateral), into, d));
    if (sideOfFrontAt(p.x, p.z, date) === side) return p;
    d += 1500;
  }
  // Fall back: step straight along the normal from the front point without lateral offset.
  for (let dd = 500; dd < 40_000; dd += 1000) {
    const p = clampToSector(add(fp, into, dd));
    if (sideOfFrontAt(p.x, p.z, date) === side) return p;
  }
  return clampToSector(add(fp, into, distance));
}

/** A point on the front near `near`, shifted along the line by `shift` metres. */
export function frontAnchor(near: XZ, date: string, shift: number): FrontPoint {
  const fp = nearestFrontPoint(near, date);
  const moved = clampToSector(add(fp, fp.tangent, shift), 12_000);
  return nearestFrontPoint(moved, date);
}

const TOWN_XZ = TOWNS.map((t) => ({ town: t, ...latLonToWorld(t.lat, t.lon) }));

export function nearestTown(p: XZ, minSize?: Town['size']): { town: Town; distance: number } {
  const order = { village: 0, town: 1, city: 2 } as const;
  let best = TOWN_XZ[0];
  let bestD = Infinity;
  for (const t of TOWN_XZ) {
    if (minSize && order[t.town.size] < order[minSize]) continue;
    const d = dist(p, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return { town: best.town, distance: bestD };
}

/** "over Cambrai", "near Arras", "east of Douai". */
export function describeLocation(p: XZ): string {
  const { town, distance } = nearestTown(p);
  if (distance < 2500) return `over ${town.name}`;
  if (distance < 9000) return `near ${town.name}`;
  const t = TOWN_XZ.find((x) => x.town === town)!;
  const dx = p.x - t.x;
  const dz = p.z - t.z;
  const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
  return `${dir} of ${town.name}`;
}
