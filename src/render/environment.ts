/**
 * Sun position and atmosphere parameters for a date / time of day over the
 * sector (≈50.3°N). Pure math; no scene objects. The sun maths lives in
 * src/world/sun.ts so the AI sees the same sun; it is re-exported here.
 */
import type { Weather } from '../core/types';
import { dayOfYear } from '../world/sun';

export { daylightHours, hourForTimeOfDay, sunPosition, type SunInfo } from '../world/sun';

/** Season 0..1 around the year (0 = 1 Jan) and a named palette key. */
export function seasonOf(date: string): { t: number; name: 'winter' | 'spring' | 'summer' | 'autumn' } {
  const doy = dayOfYear(date);
  const t = doy / 365;
  const m = Number(date.slice(5, 7));
  // Foliage lags the calendar: leaves turn in October, trees are bare Dec to mid-March.
  const d = Number(date.slice(8, 10));
  const name = m === 12 || m <= 2 || (m === 3 && d < 15) ? 'winter' : m <= 5 ? 'spring' : m <= 9 ? 'summer' : 'autumn';
  return { t, name };
}

/** Preetham turbidity from visibility (hazier = higher turbidity). */
export function turbidityFor(weather: Weather): number {
  const v = Math.max(3000, weather.visibilityM);
  return Math.min(10, Math.max(2, 2 + (40_000 / v - 1) * 1.1 + weather.cloudCover * 2));
}
