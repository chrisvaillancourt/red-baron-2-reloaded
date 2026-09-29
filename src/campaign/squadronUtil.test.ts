import { describe, expect, it } from 'vitest';
import type { AircraftSpec } from '../core/types';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { aircraftPool } from './squadronUtil';

const DATES = ['1915-08-01', '1916-03-01', '1916-07-10', '1916-12-01', '1917-05-01', '1917-10-01', '1918-06-01', '1918-10-15'];
const ROLES = ['fighter', 'two-seater', 'bomber', 'recon'] as const;

function allPools(): string[] {
  const out: string[] = [];
  for (const side of ['allied', 'central'] as const)
    for (const role of ROLES) for (const date of DATES) out.push(`${side} ${role} ${date}: ${aircraftPool(side, role, date).join(',')}`);
  return out;
}

describe('AI aircraft pools', () => {
  it('do not depend on which types the player may fly', () => {
    // The two-seaters and bombers become flyable in the bombers wave; the AI's recon and
    // bomber flights must keep flying the same types when they do.
    const before = allPools();
    const flipped = AIRCRAFT_LIST.filter((a) => (a.role === 'two-seater' || a.role === 'bomber') && !a.flyable) as AircraftSpec[];
    expect(flipped.length).toBeGreaterThan(5);
    try {
      for (const a of flipped) a.flyable = true;
      expect(allPools()).toEqual(before);
    } finally {
      for (const a of flipped) a.flyable = false;
    }
  });

  it('keep the fighter two-seater (Bristol F.2b) out of AI recon and bomber flights', () => {
    for (const date of DATES) {
      expect(aircraftPool('allied', 'recon', date)).not.toContain('bristol_f2b');
      expect(aircraftPool('allied', 'bomber', date)).not.toContain('bristol_f2b');
    }
    expect(aircraftPool('allied', 'bomber', '1917-10-01')).toContain('dh4');
  });
});
