// Cross-reference and id-uniqueness integrity for the string-keyed data tables.
// Every getX lookup is a first-match `.find`, and composeLivery falls back to {} for an
// unknown key, so a typo or duplicate id here would pass typecheck and fail silently.
// campaign.test.ts keeps the base, equipment, ace-service and medal-prerequisite checks.
import { describe, it, expect } from 'vitest';
import { SQUADRONS, SQUADRON_SUCCESSORS, getSquadronInfo } from './squadrons';
import { ACES, getAce } from './aces';
import { AERODROMES } from './aerodromes';
import { MEDALS } from './medals';
import { RANKS } from './ranks';
import { ACE_LIVERIES, SQUADRON_LIVERY_OVERRIDES } from './liveries';
import { addDays } from '../campaign/dates';
import { squadronActiveOn, squadronAircraftOn } from '../campaign/squadronUtil';

function duplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const { id } of items) (seen.has(id) ? dups : seen).add(id);
  return [...dups];
}

describe('data integrity', () => {
  it.each([
    ['SQUADRONS', SQUADRONS],
    ['ACES', ACES],
    ['AERODROMES', AERODROMES],
    ['MEDALS', MEDALS],
    ['RANKS', RANKS],
  ] as const)('%s ids are unique', (name, items) => {
    expect(items.length, `${name} is empty`).toBeGreaterThan(0);
    expect(duplicateIds(items), `duplicate ${name} ids`).toEqual([]);
  });

  it('every squadron notableAces id is an ace', () => {
    const missing = SQUADRONS.flatMap((s) => s.notableAces.filter((a) => !getAce(a)).map((a) => `${s.id}: ${a}`));
    expect(missing, 'notableAces ids with no ace').toEqual([]);
  });

  it('every ACE_LIVERIES key is an ace', () => {
    const missing = Object.keys(ACE_LIVERIES).filter((k) => !getAce(k));
    expect(missing, 'ACE_LIVERIES keys with no ace').toEqual([]);
  });

  it('every SQUADRON_LIVERY_OVERRIDES key is a squadron', () => {
    // A squadron without an override is allowed: it flies the factory finish.
    const missing = Object.keys(SQUADRON_LIVERY_OVERRIDES).filter((k) => !getSquadronInfo(k));
    expect(missing, 'SQUADRON_LIVERY_OVERRIDES keys with no squadron').toEqual([]);
  });

  it('every SQUADRON_SUCCESSORS entry names real squadrons and a usable successor', () => {
    // successorSquadron() only takes the named successor when it is active and equipped on
    // the transfer date; otherwise it silently falls back to the nearest same-nation unit.
    // Check the day after disbanding, the earliest date a transfer can happen.
    const problems: string[] = [];
    for (const [from, to] of Object.entries(SQUADRON_SUCCESSORS)) {
      const sq = getSquadronInfo(from);
      const succ = getSquadronInfo(to);
      if (!sq) problems.push(`${from}: unknown squadron`);
      if (!succ) problems.push(`${from} -> ${to}: unknown successor`);
      if (!sq || !succ) continue;
      if (succ.nation !== sq.nation) problems.push(`${from} -> ${to}: nation ${sq.nation} -> ${succ.nation}`);
      const transfer = addDays(sq.disbanded, 1);
      if (!squadronActiveOn(succ, transfer) || squadronAircraftOn(succ, transfer).length === 0) {
        problems.push(`${from} -> ${to}: successor not active and equipped on ${transfer}`);
      }
    }
    expect(problems, problems.join('; ')).toEqual([]);
  });
});
