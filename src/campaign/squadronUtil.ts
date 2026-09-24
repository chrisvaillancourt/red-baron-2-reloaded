/** Squadron queries by date: activity, base, equipment. */
import type { SquadronInfo } from '../core/campaignTypes';
import type { AircraftId, AircraftRole, Nation, Side } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT, AIRCRAFT_LIST } from '../data/aircraft';
import { getAerodrome, type AerodromeWorld } from '../data/aerodromes';
import { SQUADRONS, SQUADRON_SUCCESSORS } from '../data/squadrons';
import { daysBetween } from './dates';

export function inService(id: AircraftId, date: string): boolean {
  const s = AIRCRAFT[id];
  return !!s && s.introduced <= date && date <= s.retired;
}

export function squadronActiveOn(sq: SquadronInfo, date: string): boolean {
  return sq.formed <= date && date <= sq.disbanded;
}

export function squadronBaseOn(sq: SquadronInfo, date: string): AerodromeWorld {
  const b = sq.bases.find((x) => x.from <= date && date <= x.to) ?? (date < sq.bases[0].from ? sq.bases[0] : sq.bases[sq.bases.length - 1]);
  const a = getAerodrome(b.aerodromeId);
  if (!a) throw new Error(`Squadron ${sq.id} references unknown aerodrome ${b.aerodromeId}`);
  return a;
}

/**
 * Flyable aircraft the squadron operates on `date`, standard issue first.
 * Standard issue is the most recently introduced type that has been with
 * the unit for at least six weeks (new types trickle in to aces first).
 */
export function squadronAircraftOn(sq: SquadronInfo, date: string): AircraftId[] {
  const entries = sq.equipment.filter((e) => e.from <= date && date <= e.to);
  const scored: { id: AircraftId; from: string }[] = [];
  for (const e of entries) {
    for (const id of e.aircraft) {
      if (!inService(id, date) || !AIRCRAFT[id].flyable) continue;
      if (!scored.some((s) => s.id === id)) scored.push({ id, from: e.from });
    }
  }
  const settled = (f: string) => daysBetween(f, date) >= 42;
  scored.sort((a, b) => {
    const sa = settled(a.from);
    const sb = settled(b.from);
    if (sa !== sb) return sa ? -1 : 1;
    return a.from < b.from ? 1 : a.from > b.from ? -1 : 0;
  });
  return scored.map((s) => s.id);
}

/** Squadrons of `nation` flying on `date` with at least one flyable type available. */
export function squadronsActive(nation: Nation, date: string): SquadronInfo[] {
  return SQUADRONS.filter((s) => s.nation === nation && squadronActiveOn(s, date) && squadronAircraftOn(s, date).length > 0);
}

export function squadronsOfSide(side: Side, date: string): SquadronInfo[] {
  return SQUADRONS.filter((s) => NATION_SIDE[s.nation] === side && squadronActiveOn(s, date) && squadronAircraftOn(s, date).length > 0);
}

/** Earliest date on/after `date` on which `nation` has an active squadron. */
export function firstActiveDate(nation: Nation, date: string): string | undefined {
  const candidates = SQUADRONS.filter((s) => s.nation === nation)
    .flatMap((s) => s.equipment.map((e) => (e.from > date ? e.from : date)))
    .sort();
  return candidates.find((d) => squadronsActive(nation, d).length > 0);
}

/** Where a pilot goes when his squadron disbands. */
export function successorSquadron(sq: SquadronInfo, date: string): SquadronInfo | undefined {
  const succ = SQUADRON_SUCCESSORS[sq.id];
  const s = succ ? SQUADRONS.find((x) => x.id === succ) : undefined;
  if (s && squadronActiveOn(s, date) && squadronAircraftOn(s, date).length) return s;
  const home = squadronBaseOn(sq, sq.disbanded);
  return squadronsActive(sq.nation, date)
    .filter((x) => x.id !== sq.id)
    .sort((a, b) => {
      const da = Math.hypot(squadronBaseOn(a, date).x - home.x, squadronBaseOn(a, date).z - home.z);
      const db = Math.hypot(squadronBaseOn(b, date).x - home.x, squadronBaseOn(b, date).z - home.z);
      return da - db;
    })[0];
}

/**
 * Aircraft pool for AI flights of a side and role on a date. Falls back to
 * the earliest types of that role when none are yet in service (the roster
 * starts in mid-1915 but some roles only enter it later) — DECISIONS.md.
 */
export function aircraftPool(side: Side, role: AircraftRole | 'recon', date: string): AircraftId[] {
  const roles: AircraftRole[] = role === 'recon' ? ['two-seater'] : role === 'bomber' ? ['bomber', 'two-seater'] : [role];
  const ofSide = AIRCRAFT_LIST.filter((a) => NATION_SIDE[a.nation] === side && roles.includes(a.role) && (role === 'fighter' || !a.flyable || a.role === 'bomber'));
  const live = ofSide.filter((a) => a.introduced <= date && date <= a.retired);
  if (live.length) return live.map((a) => a.id);
  const earliest = ofSide.slice().sort((a, b) => (a.introduced < b.introduced ? -1 : 1));
  return earliest.length ? [earliest[0].id] : [];
}

/** A nation plausibly flying `id` for `side` (e.g. SPAD XIII -> France). */
export function nationForAircraft(id: AircraftId, side: Side): Nation {
  const s = AIRCRAFT[id];
  if (NATION_SIDE[s.nation] === side) return s.nation;
  const alt = s.alsoUsedBy.find((n) => NATION_SIDE[n] === side);
  return alt ?? (side === 'central' ? 'germany' : 'britain');
}
