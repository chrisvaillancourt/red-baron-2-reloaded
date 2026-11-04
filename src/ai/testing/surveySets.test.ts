import { describe, expect, it } from 'vitest';
import { SETS as AB_SETS } from '../../../tools/dev/ab.mjs';
import { FAIRNESS_SETS, RAID_SETS, TAILHOLD_SETS } from './surveySets';

// tools/dev/ab.mjs validates --set against its own copy of these names (it can't import
// the tables). A set renamed or removed here while ab still lists it would otherwise
// only surface as a failed soak child mid-survey.
describe('ab.mjs survey set names', () => {
  it.each([
    ['fairness', FAIRNESS_SETS],
    ['tailhold', TAILHOLD_SETS],
    ['raid', RAID_SETS],
  ] as const)('match the %s soak table', (soak, table) => {
    expect([...AB_SETS[soak]]).toEqual(Object.keys(table));
  });

  it('name no empty set', () => {
    for (const table of [FAIRNESS_SETS, TAILHOLD_SETS, RAID_SETS]) for (const [k, v] of Object.entries(table)) expect(v.length, k).toBeGreaterThan(0);
  });
});
