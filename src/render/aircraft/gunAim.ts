/**
 * How far a station's modelled guns can pitch (rad), from the station's own fields of fire
 * (`CrewStation.arcs`, FireArc convention: azimuth clockwise from the nose, elevation from
 * the wings), so the barrel follows the tracers the sim fires inside those arcs.
 */
import type { FireArc } from '../../core/types';

const DEG = Math.PI / 180;
/** Without arcs: a ring gun can't point much below the coaming. */
const DEFAULT: [number, number] = [-0.6, 1.45];

/** Is `az` inside the clockwise range [from, to] (which may wrap through astern)? */
function inAzimuth(az: number, from: number, to: number): boolean {
  if (to - from >= 360 || (from === -180 && to === 180)) return true;
  const span = (((to - from) % 360) + 360) % 360;
  const off = (((az - from) % 360) + 360) % 360;
  return off <= span;
}

/**
 * [min, max] pitch at azimuth `azimuthDeg`: the elevation span of the arcs covering that
 * azimuth, or of all the arcs when none does (the gun is swinging between them).
 */
export function gunPitchLimits(arcs: readonly FireArc[], azimuthDeg: number): [number, number] {
  if (!arcs.length) return DEFAULT;
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arcs) {
    if (!inAzimuth(azimuthDeg, a.azimuthDeg[0], a.azimuthDeg[1])) continue;
    lo = Math.min(lo, a.elevationDeg[0]);
    hi = Math.max(hi, a.elevationDeg[1]);
  }
  if (lo > hi) {
    for (const a of arcs) {
      lo = Math.min(lo, a.elevationDeg[0]);
      hi = Math.max(hi, a.elevationDeg[1]);
    }
  }
  return [lo * DEG, hi * DEG];
}
