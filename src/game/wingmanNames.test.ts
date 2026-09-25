import { describe, expect, it } from 'vitest';
import { wingmanLabels } from './wingmanNames';

describe('wingmanLabels', () => {
  it('uses the bare surname when it is unique', () => {
    expect(wingmanLabels([{ callsign: 'Ltn. K. Wolff' }, { callsign: 'Ltn. Voss', aceId: 'voss' }])).toEqual(['Wolff', 'Voss']);
  });

  it('adds the first-name initial when two surnames clash (the Richthofen brothers)', () => {
    const labels = wingmanLabels([
      { callsign: 'Rittm. von Richthofen', aceId: 'mvr' },
      { callsign: 'Ltn. L. von Richthofen', aceId: 'lothar' },
      { callsign: 'Ltn. K. Wolff' },
    ]);
    expect(labels).toEqual(['M. Richthofen', 'L. Richthofen', 'Wolff']);
  });

  it('falls back to the callsign without rank when initials cannot tell them apart', () => {
    const labels = wingmanLabels([{ callsign: 'Lt. J. Smith' }, { callsign: 'Capt. J. Smith' }]);
    expect(new Set(labels).size).toBe(2);
  });

  it('keeps numbered callsigns whole', () => {
    expect(wingmanLabels([{ callsign: 'Camel #2' }, { callsign: 'Camel #3' }])).toEqual(['Camel #2', 'Camel #3']);
  });
});
