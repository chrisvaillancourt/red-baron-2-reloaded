/**
 * Military ranks per nation, lowest first. `start` marks the rank a new
 * career pilot holds. `requires` gives the thresholds to be promoted INTO the
 * rank: confirmed victories OR missions flown (whichever comes first).
 * Promotions happen at most one step per debrief.
 */
import type { Rank } from '../core/campaignTypes';
import type { Nation } from '../core/types';

export interface RankDef extends Rank {
  nation: Nation;
  start?: boolean;
  requires?: { victories: number; missions: number };
  /** Officers are eligible for officer-only awards (Pour le Mérite, MC, DSO). */
  officer: boolean;
}

type Row = [title: string, abbrev: string, officer: boolean, requires?: { victories: number; missions: number }, start?: boolean];

function ladder(nation: Nation, prefix: string, rows: Row[]): RankDef[] {
  return rows.map(([title, abbrev, officer, requires, start], order) => ({
    id: `${prefix}-${abbrev.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`,
    title,
    abbrev,
    order,
    nation,
    officer,
    requires,
    start,
  }));
}

export const RANKS: readonly RankDef[] = [
  ...ladder('germany', 'de', [
    ['Vizefeldwebel', 'Vzfw.', false],
    ['Offizierstellvertreter', 'Offz.', false],
    ['Leutnant', 'Ltn.', true, undefined, true],
    ['Oberleutnant', 'Oblt.', true, { victories: 10, missions: 40 }],
    ['Hauptmann', 'Hptm.', true, { victories: 25, missions: 90 }],
    ['Major', 'Maj.', true, { victories: 50, missions: 160 }],
  ]),
  ...ladder('britain', 'gb', [
    ['Sergeant', 'Sgt.', false],
    ['Flight Sergeant', 'F/Sgt.', false],
    ['Second Lieutenant', '2/Lt.', true, undefined, true],
    ['Lieutenant', 'Lt.', true, { victories: 3, missions: 15 }],
    ['Captain', 'Capt.', true, { victories: 10, missions: 50 }],
    ['Major', 'Maj.', true, { victories: 25, missions: 110 }],
    ['Lieutenant-Colonel', 'Lt.Col.', true, { victories: 50, missions: 200 }],
  ]),
  ...ladder('france', 'fr', [
    ['Caporal', 'Cpl.', false],
    ['Sergent', 'Sgt.', false],
    ['Adjudant', 'Adj.', false],
    ['Sous-Lieutenant', 'S/Lt.', true, undefined, true],
    ['Lieutenant', 'Lt.', true, { victories: 5, missions: 25 }],
    ['Capitaine', 'Capt.', true, { victories: 15, missions: 70 }],
    ['Commandant', 'Cdt.', true, { victories: 40, missions: 160 }],
  ]),
  ...ladder('usa', 'us', [
    ['Sergeant', 'Sgt.', false],
    ['Second Lieutenant', '2nd Lt.', true, undefined, true],
    ['First Lieutenant', '1st Lt.', true, { victories: 3, missions: 15 }],
    ['Captain', 'Capt.', true, { victories: 10, missions: 50 }],
    ['Major', 'Maj.', true, { victories: 25, missions: 110 }],
    ['Lieutenant Colonel', 'Lt.Col.', true, { victories: 50, missions: 200 }],
  ]),
];

export function ranksFor(nation: Nation): RankDef[] {
  return RANKS.filter((r) => r.nation === nation);
}

export function getRank(id: string): RankDef | undefined {
  return RANKS.find((r) => r.id === id);
}

export function startRank(nation: Nation): RankDef {
  return ranksFor(nation).find((r) => r.start)!;
}

/** The next rank up, or undefined at the top of the ladder. */
export function nextRank(id: string): RankDef | undefined {
  const r = getRank(id);
  if (!r) return undefined;
  return ranksFor(r.nation).find((x) => x.order === r.order + 1);
}
