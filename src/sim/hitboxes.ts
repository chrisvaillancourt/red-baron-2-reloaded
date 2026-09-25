/**
 * Per-zone hit boxes in the aircraft body frame (forward -Z, up +Y, right +X),
 * derived from AircraftGeometry. The layout matches the contact points in
 * flightModel.ts: nose at z = -0.36 L, tail end at z = +0.62 L, lower wing
 * root just under the CG.
 */
import type { AircraftSpec, DamageZone, GroundTargetType } from '../core/types';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ZoneBox extends Box {
  zone: DamageZone;
}

export interface AircraftHitModel {
  zones: ZoneBox[];
  /** Bounding sphere radius around the CG (broad phase). */
  radius: number;
  /** Collision radius for mid-air collisions. */
  collisionRadius: number;
}

const cache = new Map<string, AircraftHitModel>();

const box = (zone: DamageZone, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ZoneBox => ({
  zone,
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
});

export function getHitModel(spec: AircraftSpec): AircraftHitModel {
  const hit = cache.get(spec.id);
  if (hit) return hit;
  const g = spec.geometry;
  const L = g.length;
  const nose = -0.36 * L;
  const tailEnd = 0.62 * L;
  const w = g.fuselageWidth / 2;
  const semi = g.span / 2;
  const zones: ZoneBox[] = [];

  if (g.pusher) {
    // D.H.2: nacelle with pilot in front, engine behind, open tail booms.
    zones.push(box('pilot', -0.32, 0.32, -0.2, 0.85, nose, nose + 0.9));
    zones.push(box('guns', -0.2, 0.2, 0.1, 0.5, nose - 0.2, nose + 0.4));
    zones.push(box('fuelTank', -0.35, 0.35, -0.3, 0.4, nose + 0.9, nose + 1.4));
    zones.push(box('engine', -0.5, 0.5, -0.3, 0.6, nose + 1.4, nose + 2.2));
    zones.push(box('fuselage', -0.4, 0.4, -0.4, 0.5, nose, nose + 2.2));
    zones.push(box('controls', -0.8, 0.8, -0.1, 0.4, nose + 2.2, 0.55 * L));
    zones.push(box('tail', -1.6, 1.6, -0.3, 1.2, 0.5 * L, tailEnd));
  } else {
    zones.push(box('engine', -w, w, -0.45, 0.45, nose, nose + 0.8));
    zones.push(box('guns', -0.3, 0.3, 0.35, 0.75, nose + 0.4, -0.3));
    zones.push(box('fuelTank', -w * 0.9, w * 0.9, -0.3, 0.4, nose + 0.8, nose + 1.3));
    zones.push(box('pilot', -0.32, 0.32, -0.25, 0.85, -0.3, 0.45));
    if (g.crew === 2) zones.push(box('gunner', -0.32, 0.32, -0.25, 0.9, 0.6, 1.4));
    zones.push(box('controls', -0.12, 0.12, -0.4, -0.1, 0.3, 0.6 * L));
    zones.push(box('fuselage', -w, w, -0.45, 0.5, nose, tailEnd));
    const tailSemi = Math.min(1.8, 0.25 * g.span);
    zones.push(box('tail', -tailSemi, tailSemi, -0.4, 1.3, 0.5 * L, tailEnd + 0.1));
  }

  let wy0: number;
  let wy1: number;
  if (g.layout === 'monoplane') {
    wy0 = -0.3;
    wy1 = 0.1;
  } else if (g.layout === 'parasol') {
    wy0 = 0.5;
    wy1 = 0.95;
  } else {
    wy0 = -0.5;
    wy1 = -0.4 + g.gap * (g.layout === 'triplane' ? 2 : 1) + 0.15;
  }
  const zFront = -g.stagger - g.chord * 0.6;
  const zBack = Math.max(g.chord, g.lowerChord) * 0.6;
  zones.push(box('leftWing', -semi, -w, wy0, wy1, zFront, zBack));
  zones.push(box('rightWing', w, semi, wy0, wy1, zFront, zBack));

  const radius = Math.hypot(semi, Math.max(L * 0.62, 1), 2) + 0.5;
  const model = { zones, radius, collisionRadius: Math.max(2.2, 0.38 * g.span) };
  cache.set(spec.id, model);
  return model;
}

/** Ground target box half-extents (x, y height full, z) and damage per round. */
export const GROUND_TARGET_BOXES: Record<GroundTargetType, { hx: number; h: number; hz: number; damagePerHit: number; blast: number }> = {
  'aa-gun': { hx: 1.5, h: 2.2, hz: 1.5, damagePerHit: 0.08, blast: 1 },
  truck: { hx: 1.1, h: 2.6, hz: 3, damagePerHit: 0.12, blast: 1 },
  artillery: { hx: 1.3, h: 2, hz: 2.5, damagePerHit: 0.08, blast: 1.2 },
  hangar: { hx: 9, h: 8, hz: 10, damagePerHit: 0.012, blast: 2 },
  'tent-hangar': { hx: 6, h: 6, hz: 7, damagePerHit: 0.03, blast: 1.5 },
  'supply-dump': { hx: 5, h: 3, hz: 5, damagePerHit: 0.02, blast: 3 },
  'trench-mg': { hx: 1, h: 1.2, hz: 1, damagePerHit: 0.12, blast: 0.6 },
  train: { hx: 1.6, h: 4, hz: 20, damagePerHit: 0.012, blast: 2.5 },
};

export const BALLOON_RADIUS = 8;

/**
 * Segment (a -> b) vs axis-aligned box: returns entry parameter t in [0,1] or -1.
 */
export function segmentBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, b: Box): number {
  let t0 = 0;
  let t1 = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return -1;
    } else {
      let ta = (b.min[i] - o[i]) / d[i];
      let tb = (b.max[i] - o[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

/** Closest distance from point p to segment a-b (all world coords). */
export function pointSegmentDistanceSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}
