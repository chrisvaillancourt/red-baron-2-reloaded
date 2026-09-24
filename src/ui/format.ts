/**
 * Unit and text formatting for UI and HUD. Pure functions (tested in Node).
 *
 * `units: 'auto'` follows the pilot's service: British and American pilots
 * read miles-per-hour and feet (RFC instruments), German and French pilots
 * read km/h and metres. RNAS-style knots are available via `speedUnit`.
 */
import type { GameSettings, Nation } from '../core/types';

export type UnitSystem = 'metric' | 'imperial';
export type SpeedUnit = 'kmh' | 'mph' | 'kt';

export interface UnitPrefs {
  system: UnitSystem;
  speed: SpeedUnit;
}

const MS_TO_KMH = 3.6;
const MS_TO_MPH = 2.2369363;
const MS_TO_KT = 1.9438445;
const M_TO_FT = 3.2808399;
const M_TO_MI = 1 / 1609.344;
const M_TO_YD = 1.0936133;

export function resolveUnits(pref: GameSettings['units'], nation: Nation): UnitPrefs {
  const system: UnitSystem =
    pref === 'metric' ? 'metric' : pref === 'imperial' ? 'imperial' : nation === 'britain' || nation === 'usa' ? 'imperial' : 'metric';
  return { system, speed: system === 'metric' ? 'kmh' : 'mph' };
}

export function speedValue(ms: number, unit: SpeedUnit): number {
  return ms * (unit === 'kmh' ? MS_TO_KMH : unit === 'mph' ? MS_TO_MPH : MS_TO_KT);
}

export function speedLabel(unit: SpeedUnit): string {
  return unit === 'kmh' ? 'km/h' : unit === 'mph' ? 'mph' : 'kt';
}

export function formatSpeed(ms: number, unit: SpeedUnit): string {
  return `${Math.round(speedValue(ms, unit))} ${speedLabel(unit)}`;
}

export function altitudeValue(m: number, system: UnitSystem): number {
  return system === 'metric' ? m : m * M_TO_FT;
}

export function altitudeLabel(system: UnitSystem): string {
  return system === 'metric' ? 'm' : 'ft';
}

/** Altitudes are rounded to 10 m / 50 ft like a period altimeter reading. */
export function formatAltitude(m: number, system: UnitSystem): string {
  const step = system === 'metric' ? 10 : 50;
  const v = Math.round(altitudeValue(m, system) / step) * step;
  return `${groupThousands(v)} ${altitudeLabel(system)}`;
}

export function formatDistance(m: number, system: UnitSystem): string {
  if (system === 'metric') {
    if (Math.abs(m) < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
  }
  const yd = m * M_TO_YD;
  if (Math.abs(yd) < 1000) return `${Math.round(yd / 10) * 10} yd`;
  const mi = m * M_TO_MI;
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

export function groupThousands(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Normalise radians to [0, 2π). */
export function normAngle(rad: number): number {
  const t = Math.PI * 2;
  return ((rad % t) + t) % t;
}

export function headingDegrees(rad: number): number {
  const d = Math.round((normAngle(rad) * 180) / Math.PI);
  return d === 360 ? 0 : d;
}

export function formatHeading(rad: number): string {
  return `${headingDegrees(rad).toString().padStart(3, '0')}°`;
}

export function cardinal(rad: number): string {
  return CARDINALS[Math.round(normAngle(rad) / (Math.PI / 8)) % 16];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map((v) => parseInt(v, 10));
  return { y, m, d };
}

/** "14 April 1917" */
export function formatDate(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "14 Apr 1917" */
export function formatDateShort(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** Days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z') + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "1h 05m" or "12m 30s" */
export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}h ${mm.toString().padStart(2, '0')}m`;
  return `${mm}m ${ss.toString().padStart(2, '0')}s`;
}

/** "00:12:30" mission clock. */
export function formatClock(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function percent(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Title-case an id like 'iron-cross-1' -> 'Iron Cross 1'. */
export function prettifyId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
