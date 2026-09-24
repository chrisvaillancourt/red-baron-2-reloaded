/**
 * Sun position and atmosphere parameters for a date / time of day over the
 * sector (≈50.3°N). Pure math; no scene objects.
 */
import type { TimeOfDay, Weather } from '../core/types';

const LAT = (50.3 * Math.PI) / 180;

export interface SunInfo {
  /** Unit vector pointing to the sun in world frame (+X east, +Y up, −Z north). */
  direction: [number, number, number];
  elevationDeg: number;
  azimuthDeg: number; // 0 = north, clockwise
  /** Local solar hour used. */
  hour: number;
}

function dayOfYear(date: string): number {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z');
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

function declination(doy: number): number {
  return (-23.44 * Math.PI) / 180 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
}

/** Local solar hours of sunrise and sunset. */
export function daylightHours(date: string): { sunrise: number; sunset: number } {
  const dec = declination(dayOfYear(date));
  const cosH = -Math.tan(LAT) * Math.tan(dec);
  const H = Math.acos(Math.max(-1, Math.min(1, cosH)));
  const half = (H * 12) / Math.PI;
  return { sunrise: 12 - half, sunset: 12 + half };
}

export function hourForTimeOfDay(date: string, tod: TimeOfDay): number {
  const { sunrise, sunset } = daylightHours(date);
  switch (tod) {
    case 'dawn':
      return sunrise + 0.45;
    case 'morning':
      return Math.max(sunrise + 2, 9);
    case 'midday':
      return 12.4;
    case 'afternoon':
      return Math.min(sunset - 2, 15.5);
    case 'dusk':
      return sunset - 0.55;
  }
}

export function sunPosition(date: string, hour: number): SunInfo {
  const dec = declination(dayOfYear(date));
  const H = ((hour - 12) * Math.PI) / 12; // hour angle
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  // Azimuth from north, clockwise.
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) az = 2 * Math.PI - az;
  const ce = Math.cos(el);
  // North = -Z, East = +X.
  const direction: [number, number, number] = [ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az)];
  return { direction, elevationDeg: (el * 180) / Math.PI, azimuthDeg: (az * 180) / Math.PI, hour };
}

/** Season 0..1 around the year (0 = 1 Jan) and a named palette key. */
export function seasonOf(date: string): { t: number; name: 'winter' | 'spring' | 'summer' | 'autumn' } {
  const doy = dayOfYear(date);
  const t = doy / 365;
  const m = Number(date.slice(5, 7));
  const name = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  return { t, name };
}

/** Preetham turbidity from visibility (hazier = higher turbidity). */
export function turbidityFor(weather: Weather): number {
  const v = Math.max(3000, weather.visibilityM);
  return Math.min(10, Math.max(2, 2 + (40_000 / v - 1) * 1.1 + weather.cloudCover * 2));
}
