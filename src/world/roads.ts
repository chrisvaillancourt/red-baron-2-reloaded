/**
 * Procedural road network linking the towns of the sector (deterministic).
 * The great routes nationales between cities/towns are near-straight
 * (many follow Roman alignments); lanes to villages wander a little.
 */
import { valueNoise } from './terrain';
import { TOWNS_WORLD, type TownWorld } from './landuse';
import type { Pt } from './segmentIndex';

export interface Road {
  from: string;
  to: string;
  points: Pt[];
  /** Metres. */
  width: number;
  major: boolean;
}

let cache: Road[] | null = null;

export function roadNetwork(): Road[] {
  if (cache) return cache;
  const roads: Road[] = [];
  const seen = new Set<string>();
  const add = (a: TownWorld, b: TownWorld, major: boolean) => {
    const key = a.name < b.name ? a.name + '|' + b.name : b.name + '|' + a.name;
    if (seen.has(key)) return;
    seen.add(key);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const steps = Math.max(4, Math.round(len / 1500));
    const wander = major ? 0.012 : 0.04;
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const env = Math.sin(t * Math.PI); // endpoints fixed
      const n = valueNoise(t * 3 + a.x * 1e-4, a.z * 1e-4 + b.x * 1e-4, 1234) * len * wander * env;
      pts.push({ x: a.x + dx * t + nx * n, z: a.z + dz * t + nz * n });
    }
    roads.push({ from: a.name, to: b.name, points: pts, width: major ? 9 : 5, major });
  };
  const big = TOWNS_WORLD.filter((t) => t.size !== 'village');
  for (const t of big) {
    const near = big
      .filter((o) => o !== t)
      .map((o) => ({ o, d: Math.hypot(o.x - t.x, o.z - t.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 4);
    for (const { o, d } of near) if (d < 45_000) add(t, o, true);
  }
  for (const v of TOWNS_WORLD.filter((t) => t.size === 'village')) {
    const near = TOWNS_WORLD.filter((o) => o !== v)
      .map((o) => ({ o, d: Math.hypot(o.x - v.x, o.z - v.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { o, d } of near) if (d < 15_000) add(v, o, false);
  }
  cache = roads;
  return roads;
}
