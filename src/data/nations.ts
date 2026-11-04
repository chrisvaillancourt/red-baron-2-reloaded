/** Per-nation presentation rules shared by campaign briefings, debriefs and the UI. */
import type { Nation } from '../core/types';

/** Language a nation's briefings and debriefs write dates in (formatLongDate). */
export const BRIEFING_LANG: Readonly<Record<Nation, 'de' | 'fr' | 'en'>> = {
  germany: 'de',
  france: 'fr',
  britain: 'en',
  usa: 'en',
};

/** Whether a nation's airmen use imperial units (feet, miles, mph). */
export function imperialNation(n: Nation): boolean {
  return n === 'britain' || n === 'usa';
}
