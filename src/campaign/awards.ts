/** Promotion and decoration rules. */
import type { CareerPilot, MedalAward, Promotion } from '../core/campaignTypes';
import { MEDALS, type MedalDef } from '../data/medals';
import { getRank, nextRank } from '../data/ranks';
import { getSquadronInfo } from '../data/squadrons';

export function confirmedVictories(p: CareerPilot): number {
  return p.victories.filter((v) => v.confirmed).length;
}

/** One step up the ladder if thresholds are met (victories OR missions). */
export function checkPromotion(p: CareerPilot): Promotion | null {
  const next = nextRank(p.rankId);
  if (!next?.requires) return null;
  const v = confirmedVictories(p);
  if (v >= next.requires.victories || p.missionsFlown >= next.requires.missions) {
    return { fromRankId: p.rankId, toRankId: next.id };
  }
  return null;
}

function fill(template: string, p: CareerPilot, date: string): string {
  const rank = getRank(p.rankId);
  const sq = getSquadronInfo(p.squadronId);
  return template
    .replaceAll('{name}', `${p.firstName} ${p.lastName}`)
    .replaceAll('{rank}', rank?.title ?? '')
    .replaceAll('{victories}', String(confirmedVictories(p)))
    .replaceAll('{squadron}', sq?.name ?? '')
    .replaceAll('{date}', date);
}

export function medalEligible(m: MedalDef, p: CareerPilot, date: string, woundedThisMission: boolean, held: Set<string>): boolean {
  if (!m.recipients.includes(p.nation) || held.has(m.id)) return false;
  if (m.availableFrom && date < m.availableFrom) return false;
  if (m.availableTo && date > m.availableTo) return false;
  const rank = getRank(p.rankId);
  if (m.officerOnly && !rank?.officer) return false;
  if (m.enlistedOnly && rank?.officer) return false;
  if (m.requires && !m.requires.every((r) => held.has(r))) return false;
  if (m.trigger === 'wounded') return woundedThisMission;
  const minV = typeof m.minVictories === 'function' ? m.minVictories(date) : m.minVictories;
  const v = confirmedVictories(p);
  const byVictories = minV !== undefined && v >= minV;
  const byMissions = m.minMissions !== undefined && p.missionsFlown >= m.minMissions;
  return byVictories || byMissions;
}

/**
 * Medals newly earned. Prerequisites must be held *before* this debrief, so
 * a pilot climbs one rung of each chain per mission, as awards trickled
 * through channels historically. At most two awards per debrief.
 */
export function checkMedals(p: CareerPilot, date: string, woundedThisMission: boolean): MedalAward[] {
  const held = new Set(p.medals.map((m) => m.medalId));
  return MEDALS.filter((m) => medalEligible(m, p, date, woundedThisMission, held))
    .sort((a, b) => a.precedence - b.precedence)
    .slice(0, 2)
    .map((m) => ({ medalId: m.id, date, citation: fill(m.citation, p, date) }));
}
