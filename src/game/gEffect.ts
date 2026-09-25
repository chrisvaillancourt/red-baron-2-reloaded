/**
 * The player's grey-out / red-out level, -1 (red-out) .. 1 (black-out).
 * `tolerance` is the sustained load the pilot bears (sim pilotGTolerance: 5.5 g
 * fit, less when wounded). Grey-out builds a g below it, so a fit pilot starts
 * greying at 4.5 g as before; red-out starts at -1.5 g scaled by the same
 * fitness ratio.
 */
export function stepGEffect(effect: number, g: number, tolerance: number, dt: number): number {
  const onset = tolerance - 1;
  const negOnset = -1.5 * (tolerance / 5.5);
  if (g > onset) return Math.min(1, effect + (g - onset) * 0.25 * dt);
  if (g < negOnset) return Math.max(-1, effect - (negOnset - g) * 0.4 * dt);
  return effect + (0 - effect) * Math.min(1, dt * 0.8);
}
