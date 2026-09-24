/** CampaignService implementation (see src/core/interfaces.ts). */
import type { CampaignService } from '../core/interfaces';
import type { AceStanding, CareerPilot, DebriefReport, NewPilotOptions, PilotSummary, QuickMissionOptions, SquadronInfo } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionResult, Nation } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { getRank, startRank } from '../data/ranks';
import { getSquadronInfo } from '../data/squadrons';
import { applyResult } from './debrief';
import { LATEST_CAREER_START, WAR_START, clampDate, isIsoDate } from './dates';
import { generateCareerMission, type GenerateOptions } from './missionGen';
import { buildQuickMission } from './quickMission';
import { Rng, hashString, seedFrom } from './rng';
import { firstActiveDate, squadronAircraftOn, squadronsActive } from './squadronUtil';
import { aceStandings } from './standings';
import { CareerStore, defaultStorage, type StorageLike } from './storage';

const DEFAULT_NAMES: Record<Nation, [string, string]> = {
  germany: ['Karl', 'Weber'],
  britain: ['John', 'Smith'],
  france: ['Jean', 'Martin'],
  usa: ['James', 'Miller'],
};

export interface CampaignServiceExt extends CampaignService {
  generateMission(p: CareerPilot, aircraftChoice?: AircraftId, options?: GenerateOptions): MissionDefinition;
  buildQuickMission(opts: QuickMissionOptions, seed?: number): MissionDefinition;
}

export function createCampaignService(storage?: StorageLike): CampaignServiceExt {
  const store = new CareerStore(storage ?? defaultStorage());

  function summary(p: CareerPilot): PilotSummary {
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      nation: p.nation,
      rankAbbrev: getRank(p.rankId)?.abbrev ?? '',
      squadronName: getSquadronInfo(p.squadronId)?.name ?? p.squadronId,
      date: p.date,
      victories: p.victories.filter((v) => v.confirmed).length,
      status: p.status,
    };
  }

  const service: CampaignServiceExt = {
    listPilots() {
      return store
        .all()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map(summary);
    },

    createPilot(opts: NewPilotOptions): CareerPilot {
      const nation = opts.nation;
      const firstName = opts.firstName?.trim() || DEFAULT_NAMES[nation][0];
      const lastName = opts.lastName?.trim() || DEFAULT_NAMES[nation][1];
      let date = clampDate(isIsoDate(opts.startDate) ? opts.startDate : '1917-04-01', WAR_START, LATEST_CAREER_START);
      let squadrons = squadronsActive(nation, date);
      if (!squadrons.length) {
        const first = firstActiveDate(nation, date);
        if (!first) throw new Error(`No ${nation} squadrons available on or after ${date}`);
        date = first;
        squadrons = squadronsActive(nation, date);
      }
      const now = new Date().toISOString();
      const rngSeed = seedFrom(firstName, lastName, nation, now, Math.random());
      const chosen = squadrons.find((s) => s.id === opts.squadronId) ?? new Rng(rngSeed).pick(squadrons);
      const p: CareerPilot = {
        id: `p-${Date.now().toString(36)}-${hashString(`${rngSeed}`).toString(36)}`,
        firstName,
        lastName,
        nation,
        side: NATION_SIDE[nation],
        difficulty: opts.difficulty,
        squadronId: chosen.id,
        rankId: startRank(nation).id,
        date,
        status: 'active',
        hospitalDays: 0,
        missionsFlown: 0,
        victories: [],
        unconfirmedClaims: 0,
        medals: [],
        log: [],
        fame: 0,
        rngSeed,
        createdAt: now,
        updatedAt: now,
      };
      store.put(p);
      return structuredClone(p);
    },

    loadPilot: (id) => store.get(id),

    savePilot(p) {
      p.updatedAt = new Date().toISOString();
      store.put(p);
    },

    deletePilot: (id) => store.delete(id),

    squadronsFor: (nation, date) => squadronsActive(nation, date),

    getSquadron: (id): SquadronInfo | undefined => getSquadronInfo(id),

    availableAircraft(p) {
      const sq = getSquadronInfo(p.squadronId);
      return sq ? squadronAircraftOn(sq, p.date) : [];
    },

    generateMission(p, aircraftChoice, options) {
      if (p.status === 'hospital') {
        // Back from hospital: the date was already advanced past the stay.
        p.status = 'active';
        p.hospitalDays = 0;
        service.savePilot(p);
      }
      if (p.status !== 'active') throw new Error(`Pilot ${p.id} cannot fly: status ${p.status}`);
      const available = service.availableAircraft(p);
      if (aircraftChoice && available.includes(aircraftChoice) && p.preferredAircraft !== aircraftChoice) {
        p.preferredAircraft = aircraftChoice;
        service.savePilot(p);
      }
      return generateCareerMission(p, aircraftChoice, options);
    },

    applyMissionResult(p, mission: MissionDefinition, result: MissionResult): DebriefReport {
      if (!mission.isCareer) throw new Error('applyMissionResult called with a non-career mission');
      const report = applyResult(p, mission, result);
      store.put(p);
      return report;
    },

    aceStandings: (p): AceStanding[] => aceStandings(p),

    buildQuickMission: (opts, seed) => buildQuickMission(opts, seed),
  };
  return service;
}
