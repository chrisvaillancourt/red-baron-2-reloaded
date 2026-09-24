/** Ace standings: historical aces' tallies on the pilot's date, plus the player. */
import type { AceStanding, CareerPilot } from '../core/campaignTypes';
import { ACES, aceVictoriesOn } from '../data/aces';
import { getRank } from '../data/ranks';
import { confirmedVictories } from './awards';
import { ARMISTICE } from './dates';

export function aceStandings(p: CareerPilot, date = p.date): AceStanding[] {
  const rows: AceStanding[] = [];
  for (const ace of ACES) {
    const altered = p.alteredAces?.[ace.id];
    const effectiveDate = altered && altered.date < date ? altered.date : date;
    const victories = aceVictoriesOn(ace, effectiveDate);
    if (victories <= 0) continue;
    let status: AceStanding['status'] = 'active';
    if (altered && altered.date <= date) status = altered.fate;
    else if (ace.fate.date && ace.fate.date <= date) {
      status = ace.fate.kind === 'killed' ? 'killed' : ace.fate.kind === 'captured' ? 'captured' : 'survived';
    }
    if (status === 'active' && date >= ARMISTICE) status = 'survived';
    rows.push({ name: ace.displayName, aceId: ace.id, nation: ace.nation, victories, isPlayer: false, status });
  }
  const rank = getRank(p.rankId);
  rows.push({
    name: `${rank?.title ?? ''} ${p.firstName} ${p.lastName}`.trim(),
    nation: p.nation,
    victories: confirmedVictories(p),
    isPlayer: true,
    status: p.status === 'killed' ? 'killed' : p.status === 'captured' ? 'captured' : p.status === 'retired' || p.status === 'war-over' ? 'survived' : 'active',
  });
  return rows.sort((a, b) => b.victories - a.victories || (a.isPlayer ? -1 : b.isPlayer ? 1 : a.name.localeCompare(b.name)));
}
