import { describe, expect, it } from 'vitest';
import type { Nation } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { createCampaignService, memoryStorage } from './index';
import { chargeNames } from './missionGen';
import { aircraftPool } from './squadronUtil';

describe('early-war two-seaters', () => {
  it('every date from mid-1915 has a period recon type on each side, except the German gap before the C.III', () => {
    for (const date of ['1915-08-01', '1916-03-01', '1916-07-10', '1916-12-01', '1917-05-01', '1917-10-01', '1918-06-01']) {
      for (const side of ['allied', 'central'] as const) {
        const pool = aircraftPool(side, 'recon', date);
        const live = pool.every((id) => AIRCRAFT[id].introduced <= date && date <= AIRCRAFT[id].retired);
        if (side === 'central' && date < '1915-12-01') expect(pool).toEqual(['albatros_ciii']);
        else expect(live, `${side} ${date}: ${pool.join(',')}`).toBe(true);
      }
    }
    expect(aircraftPool('allied', 'recon', '1916-07-10').sort()).toEqual(['be2c', 'farman_f40', 'fe2b']);
    expect(aircraftPool('central', 'recon', '1916-07-10')).toEqual(['albatros_ciii']);
  });

  const cases: [Nation, string, string][] = [
    ['britain', '1916-07-10', 'rfc24'],
    ['france', '1916-07-10', 'spa3'],
    ['germany', '1916-03-01', 'ffa62'],
  ];

  it('career missions fly two-seaters in service on the date, and escorts guard their own nation', () => {
    const s = createCampaignService(memoryStorage());
    for (const [nation, date, squadronId] of cases) {
      const p = s.createPilot({ firstName: 'Test', lastName: nation, nation, startDate: date, squadronId, difficulty: 'pilot' });
      let twoSeaters = 0;
      for (let i = 0; i < 40; i++) {
        p.missionsFlown = i;
        const m = s.generateMission(p);
        for (const f of m.flights) {
          const spec = AIRCRAFT[f.aircraftId];
          if (spec.role === 'fighter' || f.role === 'player-flight') continue;
          twoSeaters++;
          expect(spec.introduced <= m.date && m.date <= spec.retired, `${nation}: ${f.aircraftId} on ${m.date}`).toBe(true);
          if (f.role === 'friendly' && nation === 'france') expect(f.aircraftId).toBe('farman_f40');
          if (f.role === 'friendly' && nation === 'britain') expect(['be2c', 'fe2b']).toContain(f.aircraftId);
          expect(m.briefing).not.toMatch(/R\.E\.8|Rumpler/);
        }
      }
      expect(twoSeaters, `${nation} saw two-seaters`).toBeGreaterThan(0);
    }
  });

  it('names period types in briefings', () => {
    expect(chargeNames('farman_f40', '1916-07-10')).toEqual({ plural: 'F.40s', long: 'Farman F.40 machines', inService: true });
    expect(chargeNames('be2c', '1916-07-10').plural).toBe('B.E.2cs');
  });
});
