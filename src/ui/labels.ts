/** Human-readable labels for enums used across screens. */
import type { MissionType, PilotFate, SkillLevel, TimeOfDay, Weather } from '../core/types';

export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  patrol: 'Offensive Patrol',
  escort: 'Escort',
  intercept: 'Interception',
  'balloon-attack': 'Balloon Attack',
  'balloon-defense': 'Balloon Defence',
  'ground-attack': 'Ground Attack',
  'airfield-attack': 'Aerodrome Attack',
  'free-hunt': 'Free Hunt',
  dogfight: 'Dogfight',
};

export const TIME_LABEL: Record<TimeOfDay, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  dusk: 'Dusk',
};

export const SKILL_LABEL: Record<SkillLevel, string> = {
  novice: 'Novice',
  regular: 'Regular',
  veteran: 'Veteran',
  ace: 'Ace',
};

export const FATE_LABEL: Record<PilotFate, string> = {
  returned: 'Returned safely',
  'landed-elsewhere': 'Landed away from base',
  wounded: 'Wounded',
  captured: 'Taken prisoner',
  killed: 'Killed in action',
};

export function weatherSummary(w: Weather): string {
  const cover = w.cloudCover < 0.15 ? 'Clear' : w.cloudCover < 0.4 ? 'Scattered cloud' : w.cloudCover < 0.75 ? 'Broken cloud' : 'Overcast';
  const wind = Math.hypot(w.wind[0], w.wind[2]);
  const windTxt = wind < 2 ? 'calm' : wind < 7 ? 'light wind' : wind < 13 ? 'fresh wind' : 'strong wind';
  const vis = w.visibilityM < 6000 ? ', hazy' : '';
  return `${cover}, ${windTxt}${vis}`;
}

/** Compass-point wind origin, e.g. "from the WSW". Wind vector is where air is going. */
export function windFrom(w: Weather): string {
  const [x, , z] = w.wind;
  if (Math.hypot(x, z) < 1) return 'calm';
  // Direction the wind blows FROM = opposite of the vector.
  const heading = Math.atan2(-x, z);
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((heading + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 8) % 8;
  return `from the ${pts[i]}`;
}
