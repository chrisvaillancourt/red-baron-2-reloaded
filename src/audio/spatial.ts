/** Pure spatial-audio math: Doppler, air absorption, voice selection. */

export const SPEED_OF_SOUND = 343;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Doppler pitch factor for a moving source and listener.
 * f' = f · (c + v_listener→source) / (c − v_source→listener), clamped to [0.5, 2].
 */
export function dopplerFactor(srcPos: Vec3Like, srcVel: Vec3Like, lisPos: Vec3Like, lisVel: Vec3Like, c = SPEED_OF_SOUND): number {
  const dx = lisPos.x - srcPos.x;
  const dy = lisPos.y - srcPos.y;
  const dz = lisPos.z - srcPos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return 1;
  const ux = dx / d, uy = dy / d, uz = dz / d; // source -> listener
  const vs = srcVel.x * ux + srcVel.y * uy + srcVel.z * uz; // source approaching listener
  const vl = -(lisVel.x * ux + lisVel.y * uy + lisVel.z * uz); // listener approaching source
  const f = (c + Math.min(vl, c * 0.5)) / (c - Math.min(vs, c * 0.5));
  return Math.max(0.5, Math.min(2, f));
}

/** Low-pass cutoff approximating atmospheric absorption of high frequencies. */
export function airAbsorptionCutoff(distance: number): number {
  return Math.max(350, Math.min(18000, 18000 * Math.exp(-distance / 900)));
}

/** Seconds for sound to travel `distance` metres. */
export function soundDelay(distance: number): number {
  return Math.max(0, distance) / SPEED_OF_SOUND;
}

export function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Pick up to `n` sources nearest the listener within `maxDist`, preferring
 * ones already voiced (hysteresis factor) to avoid voice churn.
 */
export function selectNearest<T extends { id: number; pos: Vec3Like }>(
  sources: readonly T[],
  listener: Vec3Like,
  n: number,
  maxDist: number,
  current: ReadonlySet<number> = new Set(),
  hysteresis = 0.8,
): number[] {
  const scored: { id: number; d: number }[] = [];
  for (const s of sources) {
    const d = distance(s.pos, listener);
    if (d > maxDist) continue;
    scored.push({ id: s.id, d: current.has(s.id) ? d * hysteresis : d });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, n).map((s) => s.id);
}
