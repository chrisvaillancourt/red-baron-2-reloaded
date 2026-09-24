/** Seasonal weather and time of day for generated missions. */
import type { TimeOfDay, Weather } from '../core/types';
import { monthOf } from './dates';
import type { Rng } from './rng';

interface Season {
  cover: [number, number];
  base: [number, number];
  vis: [number, number];
  wind: [number, number];
}

function seasonFor(month: number): Season {
  if (month === 12 || month <= 2) return { cover: [0.45, 0.95], base: [600, 1500], vis: [8000, 22000], wind: [5, 14] };
  if (month <= 5) return { cover: [0.25, 0.75], base: [1000, 2200], vis: [15000, 32000], wind: [4, 11] };
  if (month <= 8) return { cover: [0.05, 0.5], base: [1400, 2800], vis: [20000, 40000], wind: [2, 8] };
  return { cover: [0.3, 0.8], base: [900, 2000], vis: [12000, 28000], wind: [4, 12] };
}

export function seasonalWeather(date: string, rng: Rng): Weather {
  const s = seasonFor(monthOf(date));
  const cloudCover = Math.round(rng.range(...s.cover) * 10) / 10;
  const cloudBaseM = Math.round(rng.range(...s.base) / 50) * 50;
  // Prevailing westerlies: blowing from WSW towards ENE (+x, slightly -z).
  const from = rng.range(200, 290) * (Math.PI / 180);
  const speed = rng.range(...s.wind);
  const toward = from + Math.PI;
  return {
    cloudCover,
    cloudBaseM,
    cloudTopM: cloudBaseM + Math.round(rng.range(300, 1500) * Math.max(0.3, cloudCover)),
    wind: [Math.sin(toward) * speed, 0, -Math.cos(toward) * speed],
    visibilityM: Math.round(rng.range(...s.vis) / 1000) * 1000,
    turbulence: Math.round(rng.range(0.05, 0.35 + cloudCover * 0.2) * 100) / 100,
  };
}

/** Days until the next flyable weather: bad winter weather grounds squadrons for longer. */
export function daysUntilNextSortie(date: string, rng: Rng): number {
  const m = monthOf(date);
  const winter = m === 12 || m <= 2;
  return 1 + (rng.chance(winter ? 0.6 : 0.35) ? 1 : 0) + (rng.chance(winter ? 0.35 : 0.1) ? 1 : 0);
}

export function randomTimeOfDay(rng: Rng): TimeOfDay {
  return rng.weighted<TimeOfDay>([
    ['dawn', 15],
    ['morning', 30],
    ['midday', 20],
    ['afternoon', 25],
    ['dusk', 10],
  ]);
}

/** "Cloud 6/10 at 1,500 metres; wind from the west, 25 km/h." */
export function describeWeather(w: Weather, imperial: boolean): string {
  const tenths = Math.round(w.cloudCover * 10);
  const sky = tenths <= 1 ? 'Clear skies' : `Cloud ${tenths}/10 at ${imperial ? `${fmt(Math.round((w.cloudBaseM * 3.281) / 100) * 100)} feet` : `${fmt(w.cloudBaseM)} metres`}`;
  const [wx, , wz] = w.wind;
  const speed = Math.hypot(wx, wz);
  // Wind is quoted by where it blows FROM.
  const fromAngle = (Math.atan2(-wx, wz) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const dir = dirs[Math.round((((fromAngle % 360) + 360) % 360) / 45) % 8];
  const wind = imperial ? `${Math.round(speed * 2.237)} mph` : `${Math.round(speed * 3.6)} km/h`;
  return `${sky}; wind from the ${dir}, ${wind}. Visibility ${imperial ? `${Math.round(w.visibilityM / 1609)} miles` : `${Math.round(w.visibilityM / 1000)} km`}.`;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}
