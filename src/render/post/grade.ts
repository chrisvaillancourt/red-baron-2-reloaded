/**
 * Color grade for the post stack (postFx.ts) from the sun and weather. Pure math.
 *
 * Clear days get a gentle S-curve and a little extra saturation, which counters
 * the flat, milky look of a display-space haze without crushing the horizon. A low
 * sun warms the highlights and cools the shadows; overcast pulls both contrast and
 * saturation back toward neutral so grey days stay grey.
 */
import type { PostGrade } from './postFx';

export function gradeFor(sunElevationDeg: number, overcast: number, visibilityM: number): PostGrade {
  const oc = Math.min(1, Math.max(0, overcast));
  // 0 at or above 30°, 1 at the horizon.
  const low = Math.min(1, Math.max(0, 1 - sunElevationDeg / 30));
  // Thick haze (under ~10 km) is the weather; keep it soft rather than fight it.
  const haze = Math.min(1, Math.max(0, (20_000 - visibilityM) / 12_000));
  const contrast = (0.28 - 0.1 * haze) * (1 - 0.55 * oc);
  const saturation = 1 + (0.08 + 0.05 * low) * (1 - 0.8 * oc);
  const warm = low * (1 - 0.7 * oc);
  return {
    contrast,
    saturation,
    gain: [1 + 0.05 * warm, 1 + 0.005 * warm, 1 - 0.06 * warm],
    lift: [0.0, 0.004 + 0.004 * warm, 0.012 + 0.014 * warm],
  };
}
