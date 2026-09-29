/**
 * The player's crew seat (docs/bombers.md, D-086): which station he works, seat cycling, and
 * the aim of a flexible gun, held in the body frame and clamped to the station's fields of
 * fire. Pure logic (three math only), tested in Node. The flight session owns the seat and
 * writes `AircraftEntity.stationInputs` from it every step.
 *
 * Angles follow `FireArc` (src/core/types.ts): azimuth 0 = the nose, +90 = the right wing,
 * ±180 = astern; elevation +90 = straight up, relative to the aircraft's own wings.
 */
import { MathUtils, type Quaternion, Vector3 } from 'three';
import type { AircraftSpec, CrewStation, CrewStationId, FireArc, StationInputs, Waypoint } from '../core/types';
import { crewStations, inAzimuth, inFireArcs } from '../data/crew';

const D2R = Math.PI / 180;

/** Body-frame unit vector for an azimuth and elevation in degrees. */
export function aimBodyVector(azimuthDeg: number, elevationDeg: number, out: Vector3): Vector3 {
  const a = azimuthDeg * D2R;
  const e = elevationDeg * D2R;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** Wrap an azimuth into (-180, 180]. */
export function wrapAzimuth(az: number): number {
  let a = ((((az + 180) % 360) + 360) % 360) - 180;
  if (a === -180) a = 180;
  return a;
}

/** The next (`dir` +1) or previous (-1) station after `current`, wrapping; the pilot's seat when alone. */
export function cycleStation(stations: readonly CrewStation[], current: CrewStationId, dir: 1 | -1): CrewStationId {
  if (stations.length === 0) return 'pilot';
  const i = Math.max(0, stations.findIndex((s) => s.id === current));
  return stations[(i + dir + stations.length) % stations.length].id;
}

/** The seat to start a flight in: the requested one when the type has it, else the pilot's. */
export function startStation(spec: AircraftSpec, requested: CrewStationId | undefined): CrewStationId {
  return requested && crewStations(spec).some((s) => s.id === requested) ? requested : 'pilot';
}

export function stationOf(spec: AircraftSpec, id: CrewStationId): CrewStation | undefined {
  return crewStations(spec).find((s) => s.id === id);
}

/** The station that aims and releases the bombs, if the type carries any. */
export function bombAimerStation(spec: AircraftSpec): CrewStation | undefined {
  return crewStations(spec).find((s) => s.bombAimer);
}

const TARGET_ACTIONS: ReadonlySet<Waypoint['action']> = new Set(['bomb', 'attack-ground', 'attack-balloon']);

/**
 * The waypoint an AI pilot taking over takes up the route at. `from` is the player's next
 * waypoint (the HUD's), which moves on within 1.5 km of a waypoint, so on the run-in it can
 * already lie past the target. A target waypoint (bomb or attack) before it whose work isn't
 * `done` is never skipped: the pilot picks up at the first of those instead.
 */
export function pilotPickupWaypoint(waypoints: readonly Waypoint[], from: number, done: (wp: Waypoint) => boolean): number {
  if (waypoints.length === 0) return 0;
  const next = Math.max(0, Math.min(from, waypoints.length - 1));
  for (let i = 0; i < next; i++) if (TARGET_ACTIONS.has(waypoints[i].action) && !done(waypoints[i])) return i;
  return next;
}

const _a = new Vector3();
const _b = new Vector3();
/** Degrees a clamped aim sits inside the edge it was pulled onto. */
const EDGE_MARGIN = 1e-4;

function angleDeg(az1: number, el1: number, az2: number, el2: number): number {
  return aimBodyVector(az1, el1, _a).angleTo(aimBodyVector(az2, el2, _b)) / D2R;
}

export interface ClampedAim {
  azimuthDeg: number;
  elevationDeg: number;
  /** True when the aim had to be pulled back onto an arc's edge. */
  limited: boolean;
}

/**
 * The aim nearest to (az, el) that lies inside the union of `arcs`, by angle on the sphere.
 * Each box is tried in turn (elevation clamped, azimuth pulled to its nearer end), and the
 * closest wins. An aim already inside is returned unchanged.
 */
export function clampToArcs(arcs: readonly FireArc[], azimuthDeg: number, elevationDeg: number): ClampedAim {
  const az = wrapAzimuth(azimuthDeg);
  const el = MathUtils.clamp(elevationDeg, -90, 90);
  const v = aimBodyVector(az, el, _a);
  if (arcs.length === 0 || inFireArcs(arcs, v.x, v.y, v.z)) return { azimuthDeg: az, elevationDeg: el, limited: false };
  let best: ClampedAim = { azimuthDeg: az, elevationDeg: el, limited: true };
  let bestAngle = Infinity;
  for (const box of arcs) {
    // A hair inside the box, so rounding in the angle conversions can't put it back outside.
    const [lo, hi] = box.elevationDeg;
    const e = MathUtils.clamp(el, lo + EDGE_MARGIN, hi - EDGE_MARGIN);
    let a = az;
    if (!inAzimuth(az, box.azimuthDeg[0], box.azimuthDeg[1], 1e-9)) {
      const d0 = Math.abs(wrapAzimuth(az - box.azimuthDeg[0]));
      const d1 = Math.abs(wrapAzimuth(az - box.azimuthDeg[1]));
      a = wrapAzimuth(d0 <= d1 ? box.azimuthDeg[0] + EDGE_MARGIN : box.azimuthDeg[1] - EDGE_MARGIN);
    }
    const ang = angleDeg(az, el, a, e);
    if (ang < bestAngle) {
      bestAngle = ang;
      best = { azimuthDeg: a, elevationDeg: e, limited: true };
    }
  }
  return best;
}

/** Where a gunner first points: over the tail, else ahead, abeam or below, whichever his arcs allow. */
export function initialAim(arcs: readonly FireArc[]): { azimuthDeg: number; elevationDeg: number } {
  const candidates: [number, number][] = [[180, 15], [0, 5], [90, 10], [-90, 10], [180, -30], [0, -30], [0, 45]];
  for (const [az, el] of candidates) {
    const v = aimBodyVector(az, el, _a);
    if (inFireArcs(arcs, v.x, v.y, v.z)) return { azimuthDeg: az, elevationDeg: el };
  }
  const c = clampToArcs(arcs, 180, 15);
  return { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg };
}

/** A flexible gun's aim, body frame, moved by the mouse and held inside its station's arcs. */
export class StationAim {
  azimuthDeg: number;
  elevationDeg: number;
  limited = false;

  constructor(
    readonly arcs: readonly FireArc[],
    azimuthDeg?: number,
    elevationDeg?: number,
  ) {
    const start = azimuthDeg === undefined || elevationDeg === undefined ? initialAim(arcs) : { azimuthDeg, elevationDeg };
    const c = clampToArcs(arcs, start.azimuthDeg, start.elevationDeg);
    this.azimuthDeg = c.azimuthDeg;
    this.elevationDeg = c.elevationDeg;
  }

  /** Swing the gun by (dAz right, dEl up) degrees; it stops at the edge of the field of fire. */
  move(dAzDeg: number, dElDeg: number): void {
    if (dAzDeg === 0 && dElDeg === 0) return;
    // Near the zenith a mouse step sweeps a smaller arc; don't let azimuth spin wildly.
    const c = clampToArcs(this.arcs, this.azimuthDeg + dAzDeg, MathUtils.clamp(this.elevationDeg + dElDeg, -89.5, 89.5));
    this.azimuthDeg = c.azimuthDeg;
    this.elevationDeg = c.elevationDeg;
    this.limited = c.limited;
  }

  body(out: Vector3): Vector3 {
    return aimBodyVector(this.azimuthDeg, this.elevationDeg, out);
  }
}

/** A polyline of [azimuth, elevation] degrees along the edge of a field of fire. */
export type ArcEdge = [number, number][];

const edgeCache = new WeakMap<readonly FireArc[], ArcEdge[]>();

/**
 * The outer edge of a union of fire arcs, as polylines sampled every `stepDeg`, for the HUD.
 * Seams where one box meets another are left out: a sample is kept only when just outside
 * it is out of every arc. Cached per arcs array.
 */
export function arcBoundary(arcs: readonly FireArc[], stepDeg = 2): ArcEdge[] {
  const cached = edgeCache.get(arcs);
  if (cached) return cached;
  const out: ArcEdge[] = [];
  const inside = (az: number, el: number) => {
    const v = aimBodyVector(az, MathUtils.clamp(el, -89.9, 89.9), _a);
    return inFireArcs(arcs, v.x, v.y, v.z);
  };
  const eps = 0.75;
  const trace = (points: [number, number][], outward: (p: [number, number]) => [number, number]) => {
    let run: ArcEdge = [];
    for (const p of points) {
      const o = outward(p);
      if (!inside(o[0], o[1])) run.push([wrapAzimuth(p[0]), p[1]]);
      else if (run.length) {
        if (run.length > 1) out.push(run);
        run = [];
      }
    }
    if (run.length > 1) out.push(run);
  };
  for (const box of arcs) {
    const [a0, a1] = box.azimuthDeg;
    const [e0, e1] = box.elevationDeg;
    const full = a1 - a0 >= 360 || (a0 === -180 && a1 === 180);
    const span = full ? 360 : (((a1 - a0) % 360) + 360) % 360;
    const n = Math.max(1, Math.ceil(span / stepDeg));
    // Floor and ceiling, unless they are the poles.
    for (const [e, sign] of [[e0, -1], [e1, 1]] as const) {
      if (Math.abs(e) >= 89.9) continue;
      const pts: [number, number][] = [];
      for (let i = 0; i <= n; i++) pts.push([a0 + (span * i) / n, e]);
      trace(pts, ([a, el]) => [a, el + sign * eps]);
    }
    if (full) continue;
    // The two sides.
    const m = Math.max(1, Math.ceil((e1 - e0) / stepDeg));
    for (const [a, sign] of [[a0, -1], [a0 + span, 1]] as const) {
      const pts: [number, number][] = [];
      for (let i = 0; i <= m; i++) pts.push([a, e0 + ((e1 - e0) * i) / m]);
      trace(pts, ([az, el]) => [az + (sign * eps) / Math.max(0.05, Math.cos(el * D2R)), el]);
    }
  }
  edgeCache.set(arcs, out);
  return out;
}

export interface StationButtons {
  fire: boolean;
  releaseBomb: boolean;
  clearJam: boolean;
}

/**
 * The `StationInputs` for this step: the body-frame aim turned into a world direction by
 * the aircraft's orientation, and the player's buttons. Only a bomb-aimer station releases.
 * Pass `into` to update the aircraft's existing inputs in place.
 */
export function stationInputsFor(station: CrewStation, aimBody: Vector3, orientation: Quaternion, b: StationButtons, into?: StationInputs): StationInputs {
  const si = into ?? { station: station.id, aim: new Vector3(), fire: false, releaseBomb: false, clearJam: false };
  si.station = station.id;
  si.aim.copy(aimBody).applyQuaternion(orientation).normalize();
  si.fire = b.fire;
  si.releaseBomb = !!station.bombAimer && b.releaseBomb;
  si.clearJam = b.clearJam;
  return si;
}
