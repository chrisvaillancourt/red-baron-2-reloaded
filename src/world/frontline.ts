/**
 * Front lines by date. STUB authored by the lead with a coarse 1916 line;
 * the world agent replaces the data with dated historical polylines but must
 * keep these exported signatures (campaign, AI, game and render import them).
 */
import { latLonToWorld } from '../core/geo';
import type { Side } from '../core/types';

export interface FrontLine {
  /** Polyline from north (coast) to south, world metres. Allied side is west. */
  points: { x: number; z: number }[];
}

const COARSE_1916: [number, number][] = [
  [51.15, 2.73], [50.95, 2.85], [50.85, 2.93], [50.72, 2.9], [50.55, 2.8],
  [50.37, 2.8], [50.28, 2.8], [50.1, 2.66], [50.0, 2.72], [49.9, 2.85], [49.55, 2.82],
];

export function frontLineAt(_date: string): FrontLine {
  return { points: COARSE_1916.map(([lat, lon]) => latLonToWorld(lat, lon)) };
}

/** Signed distance (m) from the front: negative on the allied (west) side, positive on the central side. */
export function signedDistanceToFront(x: number, z: number, date: string): number {
  const pts = frontLineAt(date).points;
  let best = Infinity;
  let sign = 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      // Line runs north->south (z increasing); east of it (cross > 0) is central.
      const cross = abz * (x - a.x) - abx * (z - a.z);
      sign = cross >= 0 ? 1 : -1;
    }
  }
  return best * sign;
}

export function sideOfFrontAt(x: number, z: number, date: string): Side {
  return signedDistanceToFront(x, z, date) > 0 ? 'central' : 'allied';
}
