/**
 * Generic squadron-mate names. Rosters are derived deterministically from the
 * pilot's seed, squadron and quarter of the year, so mates are stable for a
 * few months and then turn over as they would through losses and postings.
 */
import type { Nation, SkillLevel } from '../core/types';
import type { CareerDifficulty } from '../core/campaignTypes';
import { ranksFor } from '../data/ranks';
import { Rng, seedFrom } from './rng';

const FIRST: Record<Nation, string[]> = {
  germany: ['Hans', 'Karl', 'Otto', 'Friedrich', 'Wilhelm', 'Ernst', 'Heinrich', 'Walter', 'Kurt', 'Paul', 'Fritz', 'Josef', 'Hermann', 'Werner', 'Erich', 'Rudolf', 'Georg', 'Ludwig', 'Max', 'Franz'],
  britain: ['William', 'John', 'Arthur', 'Harold', 'Frederick', 'George', 'Thomas', 'Charles', 'Edward', 'Albert', 'Henry', 'Reginald', 'Cecil', 'Geoffrey', 'Hugh', 'Ronald', 'Leonard', 'Stanley', 'Percy', 'Alan'],
  france: ['Jean', 'Pierre', 'Louis', 'Marcel', 'Henri', 'Georges', 'André', 'René', 'Paul', 'Maurice', 'Lucien', 'Jacques', 'Robert', 'Gabriel', 'Émile', 'Joseph', 'Raymond', 'Charles', 'Armand', 'Fernand'],
  usa: ['James', 'John', 'Robert', 'Charles', 'George', 'Frank', 'Harold', 'Walter', 'Joseph', 'Edward', 'Thomas', 'William', 'Harry', 'Lawrence', 'Samuel', 'Paul', 'Howard', 'Ralph', 'Lloyd', 'Everett'],
};

const LAST: Record<Nation, string[]> = {
  germany: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schäfer', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Köhler', 'von Stein', 'von Arnim', 'Brandt', 'Vogel'],
  britain: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'White', 'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Harris', 'Clarke', 'Jackson', 'Fletcher', 'Barker', 'Maxwell', 'Fraser', 'Campbell', 'Stewart'],
  france: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'de Sevin'],
  usa: ['Miller', 'Davis', 'Anderson', 'Clark', 'Lewis', 'Young', 'Allen', 'King', 'Scott', 'Baker', 'Adams', 'Nelson', 'Hill', 'Mitchell', 'Carter', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Reed', 'Bailey', 'Cooper', 'Winslow'],
};

export interface RosterPilot {
  name: string; // "Ltn. H. Müller"
  skill: SkillLevel;
}

const SKILL_TABLE: Record<CareerDifficulty, readonly (readonly [SkillLevel, number])[]> = {
  recruit: [['regular', 3], ['veteran', 5], ['ace', 2]],
  pilot: [['novice', 2], ['regular', 5], ['veteran', 3]],
  ace: [['novice', 4], ['regular', 5], ['veteran', 1]],
};

/** Deterministic roster of squadron mates for the pilot's current quarter. */
export function squadronRoster(pilotSeed: number, squadronId: string, nation: Nation, date: string, difficulty: CareerDifficulty, size = 8, excludeSurname?: string): RosterPilot[] {
  const quarter = `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3)}`;
  const rng = new Rng(seedFrom(pilotSeed, squadronId, quarter));
  const ranks = ranksFor(nation);
  const start = ranks.find((r) => r.start)!;
  // Never give a squadron mate the player's own surname ("Ltn. Hartmann" flying with "Ltn. M. Hartmann").
  const used = new Set<string>(excludeSurname ? [excludeSurname] : []);
  const out: RosterPilot[] = [];
  while (out.length < size) {
    const first = rng.pick(FIRST[nation]);
    const last = rng.pick(LAST[nation]);
    if (used.has(last)) continue;
    used.add(last);
    const rankOrder = Math.max(0, Math.min(ranks.length - 1, start.order + rng.weighted([[-2, 1], [-1, 2], [0, 5], [1, 2], [2, 0.5]] as const)));
    const rank = ranks[rankOrder];
    out.push({ name: `${rank.abbrev} ${first[0]}. ${last}`, skill: rng.weighted(SKILL_TABLE[difficulty]) });
  }
  return out;
}
