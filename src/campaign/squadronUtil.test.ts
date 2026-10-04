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
    // Player availability must not change any AI role or date pool.
    const before = allPools();
    const original = AIRCRAFT_LIST.map((spec) => [spec as AircraftSpec, spec.flyable] as const);
    try {
      for (const [spec, flyable] of original) spec.flyable = !flyable;
      expect(allPools()).toEqual(before);
    } finally {
      for (const [spec, flyable] of original) spec.flyable = flyable;
    }
  });

  it('keep the fighter two-seater (Bristol F.2b) out of AI recon and bomber flights', () => {
    for (const date of DATES) {
      expect(aircraftPool('allied', 'recon', date)).not.toContain('bristol_f2b');
      expect(aircraftPool('allied', 'bomber', date)).not.toContain('bristol_f2b');
    }
    expect(aircraftPool('allied', 'bomber', '1917-10-01')).toContain('dh4');
  });

  it('never put a bomber or a bomb carrier in a fighter pool', () => {
    for (const side of ['allied', 'central'] as const)
      for (const date of DATES)
        for (const id of aircraftPool(side, 'fighter', date)) {
          const spec = AIRCRAFT_LIST.find((a) => a.id === id)!;
          expect(spec.role, `${side} ${date} ${id}`).toBe('fighter');
          expect(spec.bombs?.length ?? 0, `${side} ${date} ${id}`).toBe(0);
        }
  });
});
