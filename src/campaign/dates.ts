/** ISO date helpers (UTC, day resolution). */

export const WAR_START = '1915-07-01';
export const ARMISTICE = '1918-11-11';
export const LATEST_CAREER_START = '1918-10-01';

const DAY = 86_400_000;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export function clampDate(iso: string, min: string, max: string): string {
  return iso < min ? min : iso > max ? max : iso;
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "21 April 1918" (or localised month names for German/French pilots). */
export function formatLongDate(iso: string, lang: 'en' | 'de' | 'fr' = 'en'): string {
  const [y, m, d] = iso.split('-').map(Number);
  const names = lang === 'de' ? MONTHS_DE : lang === 'fr' ? MONTHS_FR : MONTHS_EN;
  return lang === 'de' ? `${d}. ${names[m - 1]} ${y}` : `${d} ${names[m - 1]} ${y}`;
}

/** Midpoint between two ISO dates. */
export function midDate(a: string, b: string): string {
  return addDays(a, Math.floor(daysBetween(a, b) / 2));
}
