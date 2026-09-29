import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../../data/aircraft';
import { crewStations } from '../../data/crew';
import { gunPitchLimits } from './gunAim';

const DEG = Math.PI / 180;
const arcsOf = (id: keyof typeof AIRCRAFT, station: string) => crewStations(AIRCRAFT[id]).find((s) => s.id === station)!.arcs;

describe('gun pitch limits from the station arcs', () => {
  it('lets a bomber nose gun point as far down as its arc allows', () => {
    const [lo, hi] = gunPitchLimits(arcsOf('gotha_gv', 'nose'), 0);
    expect(lo).toBeCloseTo(-60 * DEG, 6);
    expect(hi).toBeCloseTo(90 * DEG, 6);
  });

  it('lets a pusher nose gunner fire 37° down', () => {
    expect(gunPitchLimits(arcsOf('fe2b', 'observer'), 10)[0]).toBeCloseTo(-37 * DEG, 6);
  });

  it('uses the arcs that cover the azimuth: a ventral gun points down and aft only', () => {
    const [lo, hi] = gunPitchLimits(arcsOf('gotha_gv', 'ventral'), 180);
    expect(lo).toBeCloseTo(-90 * DEG, 6);
    expect(hi).toBeCloseTo(-4 * DEG, 6);
  });

  it('falls back to every arc outside them, and to a fixed range without arcs', () => {
    // Dead ahead is in none of the B.E.2c observer's arcs (sides −30…25°, aft 12…60°).
    const [lo, hi] = gunPitchLimits(arcsOf('be2c', 'observer'), 0);
    expect(lo).toBeCloseTo(-30 * DEG, 6);
    expect(hi).toBeCloseTo(60 * DEG, 6);
    // The Gotha dorsal gun ahead: only the high arc covers it.
    expect(gunPitchLimits(arcsOf('gotha_gv', 'dorsal'), 0)[0]).toBeCloseTo(40 * DEG, 6);
    expect(gunPitchLimits([], 0)).toEqual([-0.6, 1.45]);
  });
});
