import { describe, expect, it } from 'vitest';
import {
  addDays,
  cardinal,
  daysBetween,
  formatAltitude,
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
  formatHeading,
  formatSpeed,
  ordinal,
  prettifyId,
  resolveUnits,
} from './format';

describe('resolveUnits', () => {
  it('auto follows the pilot service', () => {
    expect(resolveUnits('auto', 'britain')).toEqual({ system: 'imperial', speed: 'mph' });
    expect(resolveUnits('auto', 'usa')).toEqual({ system: 'imperial', speed: 'mph' });
    expect(resolveUnits('auto', 'germany')).toEqual({ system: 'metric', speed: 'kmh' });
    expect(resolveUnits('auto', 'france')).toEqual({ system: 'metric', speed: 'kmh' });
  });
  it('explicit preference overrides nation', () => {
    expect(resolveUnits('metric', 'britain').system).toBe('metric');
    expect(resolveUnits('imperial', 'germany').system).toBe('imperial');
  });
});

describe('speed/altitude/distance', () => {
  it('formats speed in each unit', () => {
    expect(formatSpeed(50, 'kmh')).toBe('180 km/h');
    expect(formatSpeed(50, 'mph')).toBe('112 mph');
    expect(formatSpeed(50, 'kt')).toBe('97 kt');
  });
  it('rounds altitude like an altimeter', () => {
    expect(formatAltitude(3004, 'metric')).toBe('3,000 m');
    expect(formatAltitude(3000, 'imperial')).toBe('9,850 ft');
  });
  it('switches distance scale', () => {
    expect(formatDistance(450, 'metric')).toBe('450 m');
    expect(formatDistance(4500, 'metric')).toBe('4.5 km');
    expect(formatDistance(45_000, 'metric')).toBe('45 km');
    expect(formatDistance(300, 'imperial')).toBe('330 yd');
    expect(formatDistance(8047, 'imperial')).toBe('5.0 mi');
  });
});

describe('headings', () => {
  it('pads degrees and wraps', () => {
    expect(formatHeading(0)).toBe('000°');
    expect(formatHeading(Math.PI / 4)).toBe('045°');
    expect(formatHeading(-Math.PI / 2)).toBe('270°');
    expect(formatHeading(Math.PI * 2 - 0.001)).toBe('000°');
  });
  it('names cardinals', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(Math.PI / 2)).toBe('E');
    expect(cardinal(Math.PI * 1.25)).toBe('SW');
  });
});

describe('dates and times', () => {
  it('formats period dates', () => {
    expect(formatDate('1917-04-14')).toBe('14 April 1917');
  });
  it('does date arithmetic', () => {
    expect(daysBetween('1917-04-01', '1917-04-30')).toBe(29);
    expect(addDays('1918-02-27', 3)).toBe('1918-03-02');
  });
  it('formats durations and clocks', () => {
    expect(formatDuration(750)).toBe('12m 30s');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatClock(3725)).toBe('01:02:05');
  });
  it('ordinals and ids', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 80].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '80th']);
    expect(prettifyId('pour-le-merite')).toBe('Pour Le Merite');
  });
});
