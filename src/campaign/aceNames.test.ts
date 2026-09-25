import { describe, expect, it } from 'vitest';
import { ACES, aceNamesOn, getAce } from '../data/aces';
import { chargeNames } from './missionGen';

describe('ace names follow the calendar', () => {
  it('uses the rank and honours held on the date', () => {
    const bishop = getAce('bishop')!;
    expect(aceNamesOn(bishop, '1917-06-19').display).toBe('Captain William Bishop');
    expect(aceNamesOn(bishop, '1917-09-01').display).toBe('Captain William Bishop VC');
    expect(aceNamesOn(bishop, '1918-06-01')).toEqual({ display: 'Major William Bishop VC', short: 'Maj. Bishop' });
    expect(aceNamesOn(getAce('guynemer')!, '1916-07-01').short).toBe('S/Lt. Guynemer');
    expect(aceNamesOn(getAce('mvr')!, '1917-01-20').display).toBe('Leutnant Manfred Freiherr von Richthofen');
    // Mannock's VC was gazetted after the war: never shown in-game.
    expect(aceNamesOn(getAce('mannock')!, '1918-11-11').display).toBe('Major Edward Mannock');
  });

  it('every rank history ends on the rank in the static names', () => {
    for (const ace of ACES) {
      const final = ace.ranks?.at(-1);
      if (!final) continue;
      expect(ace.displayName.startsWith(`${final.title} `), ace.id).toBe(true);
      expect(ace.shortName.startsWith(`${final.abbrev} `), ace.id).toBe(true);
    }
  });
});

describe('two-seater names in briefings', () => {
  it('names stand-in types generically before they entered service', () => {
    expect(chargeNames('re8', '1916-07-10')).toEqual({ plural: 'two-seaters', long: 'observation two-seaters', inService: false });
    expect(chargeNames('re8', '1917-06-10').plural).toBe('R.E.8s');
  });
});
