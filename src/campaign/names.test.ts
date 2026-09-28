import { describe, expect, it } from 'vitest';
import { ranksFor } from '../data/ranks';
import { squadronRoster } from './names';

const abbrevOf = (name: string) => name.slice(0, name.search(/ \p{Lu}\. /u));

describe('squadron rosters', () => {
  it('Lafayette mates carry French ranks; the 103rd Aero and 94th carry US ranks', () => {
    const french = new Set(ranksFor('france').map((r) => r.abbrev));
    const us = new Set(ranksFor('usa').map((r) => r.abbrev));
    for (let seed = 1; seed <= 5; seed++) {
      const laf = squadronRoster(seed, 'n124', 'usa', '1917-06-01', 'pilot', 20).map((r) => abbrevOf(r.name));
      for (const a of laf) expect(french.has(a), a).toBe(true);
      // Ranks the US ladder doesn't have (Caporal, Adjudant, Sous-Lieutenant, Lieutenant).
      expect(laf.some((a) => !us.has(a))).toBe(true);
      for (const sq of ['us103', 'us94']) {
        for (const r of squadronRoster(seed, sq, 'usa', '1918-06-01', 'pilot', 20)) expect(us.has(abbrevOf(r.name)), r.name).toBe(true);
      }
    }
  });
});
