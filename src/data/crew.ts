/**
 * Crew stations (docs/bombers.md): who sits where, which guns they work, and where those
 * guns can bear. Read every aircraft's stations through `crewStations(spec)`, which derives
 * them for types that don't list their own: the pilot with the fixed guns, and, when the
 * type has flexible guns, one observer with all of them.
 *
 * Arcs are in the body frame (see `FireArc` in src/core/types.ts). The derived observer
 * arcs reproduce the field of fire the rear gunner had before stations existed
 * (`flexibleArc` in src/sim/combat.ts) to within a few degrees.
 */
import type { AircraftSpec, CrewStation, FireArc } from '../core/types';

/** Observer facing aft (Bristol, D.H.4, Rumpler...): the upper wing and propeller blank the nose low, the tail blanks astern low. */
export const REAR_OBSERVER_ARCS: readonly FireArc[] = Object.freeze([
  { azimuthDeg: [-180, 180], elevationDeg: [30, 90] },
  { azimuthDeg: [57, 143], elevationDeg: [-20, 30] },
  { azimuthDeg: [-143, -57], elevationDeg: [-20, 30] },
  { azimuthDeg: [143, -143], elevationDeg: [7, 30] },
]);

/** Pusher nose gunner (F.E.2b, Farman, Voisin): open ahead and below; he fires aft only up over the top wing. */
export const NOSE_GUNNER_ARCS: readonly FireArc[] = Object.freeze([
  { azimuthDeg: [-104, 104], elevationDeg: [-37, 90] },
  { azimuthDeg: [-180, 180], elevationDeg: [33, 90] },
]);

const cache = new WeakMap<AircraftSpec, readonly CrewStation[]>();

/** The aircraft's crew stations, pilot first. Cached per spec; don't mutate the result. */
export function crewStations(spec: AircraftSpec): readonly CrewStation[] {
  let s = cache.get(spec);
  if (!s) {
    s = spec.crewStations ?? deriveStations(spec);
    cache.set(spec, s);
  }
  return s;
}

function deriveStations(spec: AircraftSpec): CrewStation[] {
  const fixed: number[] = [];
  const flexible: number[] = [];
  spec.guns.forEach((g, i) => (g.mount === 'flexible' ? flexible : fixed).push(i));
  const hasObserver = flexible.length > 0 && spec.geometry.crew >= 2;
  const bombs = !!spec.bombs?.length;
  const pilot: CrewStation = { id: 'pilot', label: 'Pilot', crewIndex: 0, guns: hasObserver ? fixed : [...fixed, ...flexible], arcs: [] };
  if (bombs && !hasObserver) pilot.bombAimer = true;
  if (!hasObserver) return [pilot];
  const forward = spec.geometry.pusher && spec.guns[flexible[0]].position[2] < 0;
  const observer: CrewStation = {
    id: 'observer',
    label: forward ? 'Nose gunner' : 'Observer',
    crewIndex: 1,
    guns: flexible,
    arcs: (forward ? NOSE_GUNNER_ARCS : REAR_OBSERVER_ARCS).map(cloneArc),
  };
  if (bombs) observer.bombAimer = true;
  return [pilot, observer];
}

const cloneArc = (a: FireArc): FireArc => ({ azimuthDeg: [a.azimuthDeg[0], a.azimuthDeg[1]], elevationDeg: [a.elevationDeg[0], a.elevationDeg[1]] });

/** The station a gun is worked from, or undefined for a gun no station lists. */
export function stationForGun(spec: AircraftSpec, mountIndex: number): CrewStation | undefined {
  return crewStations(spec).find((s) => s.guns.includes(mountIndex));
}

/** Eye point of a station, body frame: its own `eye`, else 0.45 m above and 0.35 m behind its first gun. Null for the pilot without an `eye` (use the model's EyePoint). */
export function stationEye(spec: AircraftSpec, station: CrewStation): [number, number, number] | null {
  if (station.eye) return station.eye;
  if (station.id === 'pilot' || station.guns.length === 0) return null;
  const p = spec.guns[station.guns[0]].position;
  return [p[0], p[1] + 0.45, p[2] + 0.35];
}

const DEG = 180 / Math.PI;

/** Azimuth and elevation (degrees, `FireArc` convention) of a body-frame direction. */
export function bodyDirectionAngles(x: number, y: number, z: number): { azimuthDeg: number; elevationDeg: number } {
  const h = Math.hypot(x, z);
  return { azimuthDeg: Math.atan2(x, -z) * DEG, elevationDeg: Math.atan2(y, h) * DEG };
}

/** Is the azimuth inside the clockwise range [from, to], which may wrap through astern? */
function inAzimuth(az: number, from: number, to: number): boolean {
  if (to - from >= 360 || (from === -180 && to === 180)) return true;
  const span = (((to - from) % 360) + 360) % 360;
  const off = (((az - from) % 360) + 360) % 360;
  return off <= span;
}

/** Does a body-frame direction (any length) lie inside any of the arcs? */
export function inFireArcs(arcs: readonly FireArc[], x: number, y: number, z: number): boolean {
  const { azimuthDeg, elevationDeg } = bodyDirectionAngles(x, y, z);
  for (const a of arcs) {
    if (elevationDeg < a.elevationDeg[0] || elevationDeg > a.elevationDeg[1]) continue;
    // Straight up or down, azimuth is undefined: any arc reaching that elevation covers it.
    if (Math.abs(elevationDeg) > 89.9 || inAzimuth(azimuthDeg, a.azimuthDeg[0], a.azimuthDeg[1])) return true;
  }
  return false;
}

/**
 * Problems with a spec's crew stations, empty when sound: the pilot first at crew index 0,
 * each gun worked from exactly one station, crew indices within `geometry.crew`, arcs only
 * on flexible guns, at most one bomb-aimer station and only on a type that carries bombs.
 */
export function crewStationProblems(spec: AircraftSpec): string[] {
  const out: string[] = [];
  const st = crewStations(spec);
  if (st[0]?.id !== 'pilot' || st[0].crewIndex !== 0) out.push('the first station must be the pilot at crew index 0');
  const ids = new Set<string>();
  const worked = new Map<number, string>();
  for (const s of st) {
    if (ids.has(s.id)) out.push(`station ${s.id} listed twice`);
    ids.add(s.id);
    if (s.crewIndex < 0 || s.crewIndex >= spec.geometry.crew) out.push(`${s.id}: crew index ${s.crewIndex} outside a crew of ${spec.geometry.crew}`);
    for (const g of s.guns) {
      if (!spec.guns[g]) out.push(`${s.id}: no gun ${g}`);
      else if (worked.has(g)) out.push(`gun ${g} worked from ${worked.get(g)} and ${s.id}`);
      else worked.set(g, s.id);
    }
    const flexible = s.guns.some((g) => spec.guns[g]?.mount === 'flexible');
    if (flexible && s.arcs.length === 0) out.push(`${s.id}: flexible guns but no arcs`);
    for (const a of s.arcs) {
      const [lo, hi] = a.elevationDeg;
      if (lo > hi || lo < -90 || hi > 90) out.push(`${s.id}: bad elevation range [${lo}, ${hi}]`);
    }
  }
  spec.guns.forEach((_, i) => {
    if (!worked.has(i)) out.push(`gun ${i} has no station`);
  });
  const aimers = st.filter((s) => s.bombAimer).length;
  if (aimers > 1) out.push('more than one bomb-aimer station');
  if (aimers > 0 && !spec.bombs?.length) out.push('a bomb aimer on a type with no bombs');
  if (spec.bombs?.length && aimers === 0) out.push('bombs but no bomb-aimer station');
  return out;
}
