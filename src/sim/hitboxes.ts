/**
 * Per-zone hit boxes in the aircraft body frame (forward -Z, up +Y, right +X),
 * derived from AircraftGeometry. The layout matches the contact points in
 * flightModel.ts: nose at z = -0.36 L, tail end at z = +0.62 L, lower wing
 * root just under the CG.
 */
import type { AircraftSpec, CrewStationId, DamageZone, GroundTargetType } from '../core/types';
import { crewStations, stationEye } from '../data/crew';
import { engineOffsetX } from './flightModel';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ZoneBox extends Box {
  zone: DamageZone;
  /** Gunner boxes of types with explicit stations: the crew member (`crewWounds` index). */
  crewIndex?: number;
  /** ...and the station the box stands at; the man is only in it while he works that station. */
  station?: CrewStationId;
  /** Engine boxes of multi-engine types: the engine (`DamageState.engines` index, left first). */
  engineIndex?: number;
}

export interface AircraftHitModel {
  zones: ZoneBox[];
  /** Bounding sphere radius around the CG (broad phase). */
  radius: number;
  /** Collision radius for mid-air collisions. */
  collisionRadius: number;
  /** An engine box per nacelle (`engineIndex` set): a round stops at the first engine along its path. */
  multiEngine?: boolean;
}

const cache = new WeakMap<AircraftSpec, AircraftHitModel>();

const box = (zone: DamageZone, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ZoneBox => ({
  zone,
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
});

/** The observer sits ahead of the pilot (B.E.2c front seat, F.E.2b/Farman nose). */
export function observerForward(spec: AircraftSpec): boolean {
  const flex = spec.guns.find((m) => m.mount === 'flexible');
  return spec.geometry.crew >= 2 && !!flex && flex.position[2] < 0;
}

/** The observer's gun commands the forward hemisphere (pusher nose gunner) rather than the rear. */
export function gunnerFacesForward(spec: AircraftSpec): boolean {
  return spec.geometry.pusher && observerForward(spec);
}

/** Cached by spec identity; treat the spec and returned hit model as immutable. */
export function getHitModel(spec: AircraftSpec): AircraftHitModel {
  const hit = cache.get(spec);
  if (hit) return hit;
  const model = deriveHitModel(spec);
  cache.set(spec, model);
  return model;
}

function deriveHitModel(spec: AircraftSpec): AircraftHitModel {
  const g = spec.geometry;
  const L = g.length;
  const nose = -0.36 * L;
  const tailEnd = 0.62 * L;
  const w = g.fuselageWidth / 2;
  const semi = g.span / 2;
  const zones: ZoneBox[] = [];

  if (g.pusher && g.crew >= 2) {
    // F.E.2b / Farman: observer in the nose, pilot behind him, engine at the back of the nacelle.
    const n = Math.max(nose, -3.0);
    zones.push(box('gunner', -0.35, 0.35, -0.2, 0.9, n, n + 0.9));
    zones.push(box('guns', -0.2, 0.2, 0.3, 0.9, n - 0.2, n + 0.4));
    zones.push(box('pilot', -0.32, 0.32, -0.1, 0.95, n + 0.9, n + 1.8));
    zones.push(box('fuelTank', -0.35, 0.35, -0.3, 0.4, n + 1.8, n + 2.3));
    zones.push(box('engine', -0.5, 0.5, -0.3, 0.7, n + 2.3, n + 3.1));
    zones.push(box('fuselage', -0.45, 0.45, -0.4, 0.6, n, n + 3.1));
    zones.push(box('controls', -1.2, 1.2, -0.1, 0.4, n + 3.1, 0.55 * L));
    zones.push(box('tail', -1.8, 1.8, -0.3, 1.3, 0.5 * L, tailEnd));
  } else if (g.pusher) {
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
    if (g.crew >= 2) {
      // B.E.2c-style front observer sits under the upper wing, ahead of the pilot.
      if (observerForward(spec)) zones.push(box('gunner', -0.32, 0.32, -0.25, 0.9, -1.5, -0.6));
      else zones.push(box('gunner', -0.32, 0.32, -0.25, 0.9, 0.6, 1.4));
    }
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

  if (spec.crewStations) stationBoxes(spec, zones);
  const engines = spec.performance.engineCount ?? 1;
  const multiEngine = engines > 1 && (g.nacelleOffsetX ?? 0) > 0;
  if (multiEngine) nacelleBoxes(spec, zones, zFront, zBack);

  const radius = Math.hypot(semi, Math.max(L * 0.62, 1), 2) + 0.5;
  return { zones, radius, collisionRadius: Math.max(2.2, 0.38 * g.span), ...(multiEngine ? { multiEngine } : {}) };
}

/**
 * Explicit stations replace the single rear-gunner box. Standing gunners keep the usual
 * torso below their eye; prone gunners lie forward from a floor hatch, with their head at
 * the opening. The pilot retains his seated box regardless of gunner posture.
 */
function stationBoxes(spec: AircraftSpec, zones: ZoneBox[]) {
  for (let i = zones.length - 1; i >= 0; i--) if (zones[i].zone === 'gunner') zones.splice(i, 1);
  for (const st of crewStations(spec)) {
    const eye = stationEye(spec, st);
    if (!eye) continue;
    const [x, y, z] = eye;
    if (st.crewIndex === 0) {
      const k = zones.findIndex((b) => b.zone === 'pilot');
      if (k >= 0) zones[k] = box('pilot', x - 0.32, x + 0.32, y - 1.1, y + 0.1, z - 0.4, z + 0.45);
      continue;
    }
    const body = st.posture === 'prone'
      ? box('gunner', x - 0.35, x + 0.35, y - 0.05, y + 0.45, z - 1.2, z + 0.15)
      : box('gunner', x - 0.35, x + 0.35, y - 1.2, y + 0.15, z - 0.45, z + 0.45);
    zones.push({ ...body, crewIndex: st.crewIndex, station: st.id });
  }
}

/** Twins: an engine box on each nacelle (left engine 0), in place of the one in the nose. */
function nacelleBoxes(spec: AircraftSpec, zones: ZoneBox[], zFront: number, zBack: number) {
  const g = spec.geometry;
  const n = spec.performance.engineCount ?? 1;
  const k = zones.findIndex((b) => b.zone === 'engine');
  if (k >= 0) zones.splice(k, 1);
  // Shipped twins share cowling geometry with the model generator. Fuselage `pusher`
  // describes tail booms, not nacelle propulsion (the Gotha has an ordinary fuselage).
  const nacelle = g.nacelle;
  const [z0, z1] = nacelle
    ? [nacelle.centerZ - nacelle.length / 2, nacelle.centerZ + nacelle.length / 2]
    : g.pusher ? [zBack - 0.6, zBack + 1.4] : [zFront - 1.4, zFront + 0.6];
  const halfWidth = nacelle?.radius ?? 0.5;
  const y0 = nacelle ? nacelle.centerY - 1.12 * nacelle.radius : -0.65;
  const y1 = nacelle ? nacelle.centerY + 1.12 * nacelle.radius : 0.45;
  for (let i = 0; i < n; i++) {
    const x = engineOffsetX(spec, i);
    zones.push({ ...box('engine', x - halfWidth, x + halfWidth, y0, y1, z0, z1), engineIndex: i });
  }
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

/** The zone a `bullet-hit` event names when a round crosses several boxes: the first of these. */
export const HIT_PRIORITY: readonly DamageZone[] = ['pilot', 'engine', 'fuelTank', 'gunner', 'controls', 'guns', 'tail', 'leftWing', 'rightWing', 'fuselage'];

/** A zone box on a round's path: the crew or engine index, and the entry parameter along the path. */
export interface PathHit {
  zone: DamageZone;
  index: number | undefined;
  t: number;
}

export interface RoundTrace {
  /** Entry into the airframe along the step's segment (0..1). */
  entry: number;
  /** Every occupied box the round crosses on its way through the airframe, in zone-list order. */
  crossed: PathHit[];
  /** The ones it damages, in zone-list order: `crossed` less those the engine block shields. */
  damaged: PathHit[];
}

type Point = { readonly x: number; readonly y: number; readonly z: number };

/**
 * A round through an aircraft, in its body frame. `a` -> `b` is the round's motion this step
 * relative to the aircraft; `occupied` drops boxes nobody is in (a station its man has left).
 * Rounds pass through fabric, so the trace runs on from the entry point through the whole
 * airframe (twice the bounding radius). Null: the round misses every box.
 *
 * The engine block stops a round. With `pathOrder` the first engine along the path stops it,
 * so every zone entered after it is spared. Without it, the older cut by zone-list order: in a
 * tractor the engine is listed first, so it shields everything else on the path
 * (docs/sim.md "Hit boxes").
 */
export function traceRound(hm: AircraftHitModel, a: Point, b: Point, occupied: (zb: ZoneBox) => boolean, pathOrder: boolean): RoundTrace | null {
  let entry = 2;
  for (const zb of hm.zones) {
    if (!occupied(zb)) continue;
    const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, zb);
    if (t >= 0 && t < entry) entry = t;
  }
  if (entry > 1) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = 1 / Math.max(len, 1e-6);
  const ux = dx * k;
  const uy = dy * k;
  const uz = dz * k;
  const s = len * entry;
  const sx = a.x + ux * s;
  const sy = a.y + uy * s;
  const sz = a.z + uz * s;
  const r = hm.radius * 2;
  const ex = sx + ux * r;
  const ey = sy + uy * r;
  const ez = sz + uz * r;
  const crossed: PathHit[] = [];
  for (const zb of hm.zones) {
    if (!occupied(zb)) continue;
    const t = segmentBox(sx, sy, sz, ex, ey, ez, zb);
    if (t < 0) continue;
    crossed.push({ zone: zb.zone, index: zb.crewIndex ?? zb.engineIndex, t });
  }
  if (crossed.length === 0) return null;
  let damaged = crossed;
  if (pathOrder) {
    let stop = Infinity;
    for (const h of crossed) if (h.zone === 'engine') stop = Math.min(stop, h.t);
    damaged = crossed.filter((h) => h.t <= stop);
  } else {
    const e = crossed.findIndex((h) => h.zone === 'engine');
    if (e >= 0) damaged = crossed.slice(0, e + 1);
  }
  return { entry, crossed, damaged };
}

/** The zone of `hits` first in HIT_PRIORITY (the earliest listed on a tie). */
export function priorityZone(hits: readonly PathHit[]): DamageZone {
  let best = hits[0].zone;
  let bestPri = HIT_PRIORITY.indexOf(best);
  for (const h of hits) {
    const p = HIT_PRIORITY.indexOf(h.zone);
    if (p < bestPri) {
      bestPri = p;
      best = h.zone;
    }
  }
  return best;
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
