/**
 * Career/campaign contracts shared by src/campaign (implementation) and
 * src/ui (screens). See src/core/interfaces.ts CampaignService.
 */
import type { AircraftId, Livery, MissionType, Nation, PilotFate, SkillLevel, Side, VictoryClaim } from './types';

export type CareerDifficulty = 'recruit' | 'pilot' | 'ace';

export interface NewPilotOptions {
  firstName: string;
  lastName: string;
  nation: Nation;
  /** ISO date the career begins; clamped to 1915-07-01 .. 1918-10-01. */
  startDate: string;
  /** Optional preferred squadron; otherwise campaign assigns one. */
  squadronId?: string;
  difficulty: CareerDifficulty;
}

export interface Rank {
  id: string;
  /** Full title, e.g. "Leutnant", "Captain". */
  title: string;
  /** Abbreviation used in rosters, e.g. "Ltn.", "Capt.". */
  abbrev: string;
  order: number; // 0 = lowest
}

export interface MedalAward {
  medalId: string;
  date: string;
  citation: string;
}

export interface LogbookEntry {
  date: string;
  missionType: MissionType;
  missionTitle: string;
  aircraftId: AircraftId;
  outcome: PilotFate;
  claims: number;
  confirmed: number;
  notes: string;
}

export interface ConfirmedVictory {
  number: number; // victory #N in the pilot's career
  date: string;
  victim: string; // "Sopwith Camel" / "Balloon"
  victimAceId?: string;
  location: string; // "near Cambrai"
  confirmed: boolean;
}

export type PilotStatus = 'active' | 'hospital' | 'captured' | 'killed' | 'retired' | 'war-over';

export interface CareerPilot {
  id: string;
  firstName: string;
  lastName: string;
  nation: Nation;
  side: Side;
  difficulty: CareerDifficulty;
  squadronId: string;
  rankId: string;
  /** Current campaign date. */
  date: string;
  status: PilotStatus;
  /** Days remaining in hospital when status = 'hospital'. */
  hospitalDays: number;
  missionsFlown: number;
  victories: ConfirmedVictory[];
  /** Unconfirmed claims count. */
  unconfirmedClaims: number;
  medals: MedalAward[];
  log: LogbookEntry[];
  /** 0..100 renown, drives promotions/medals/newspaper notices. */
  fame: number;
  /** Aircraft id the pilot has chosen to fly when the squadron offers a choice. */
  preferredAircraft?: AircraftId;
  /** Personal livery override once pilot is famous enough (RB2 let aces paint aircraft). */
  personalLivery?: Livery;
  /**
   * Historical aces whose fate this career has changed (shot down by the
   * player, or lost flying in the player's flight). They stop scoring and
   * appearing from `date`.
   */
  alteredAces?: Record<string, { fate: 'killed' | 'captured'; date: string }>;
  /** Seed for deterministic mission generation. */
  rngSeed: number;
  createdAt: string;
  updatedAt: string;
}

export interface PilotSummary {
  id: string;
  name: string;
  nation: Nation;
  rankAbbrev: string;
  squadronName: string;
  date: string;
  victories: number;
  status: PilotStatus;
}

export interface SquadronInfo {
  id: string; // 'jasta11', 'rfc56', 'n3', 'us94'
  name: string; // "Jagdstaffel 11"
  shortName: string; // "Jasta 11"
  nation: Nation;
  /** Service window. */
  formed: string;
  disbanded: string;
  /** Aerodrome ids by date range (squadrons moved). */
  bases: { from: string; to: string; aerodromeId: string }[];
  /** Aircraft equipment by date range. */
  equipment: { from: string; to: string; aircraft: AircraftId[] }[];
  /** Squadron livery baseline (individual markings are added per pilot). */
  livery: Livery;
  /** Famous pilots who served, with ace ids. */
  notableAces: string[];
  motto?: string;
  description: string;
}

export interface AceStanding {
  name: string;
  aceId?: string;
  nation: Nation;
  victories: number;
  isPlayer: boolean;
  status: 'active' | 'killed' | 'captured' | 'survived';
}

export interface Promotion {
  fromRankId: string;
  toRankId: string;
}

export interface DebriefReport {
  missionTitle: string;
  pilotFate: PilotFate;
  missionSuccess: boolean;
  claims: (VictoryClaim & { confirmed: boolean })[];
  promotion: Promotion | null;
  medals: MedalAward[];
  /** Period-voice paragraphs: CO's remarks, newspaper clipping, hospital note... */
  narrative: string[];
  newspaperHeadline?: string;
  /** Days that pass before the next mission (sortie cadence, hospital stays). */
  daysElapsed: number;
  /** Transfer to another squadron, if any. */
  transferToSquadronId?: string;
  /** Career over (killed/captured/war ended). */
  careerEnded: boolean;
}

export interface QuickMissionOptions {
  playerAircraft: AircraftId;
  playerSide?: Side; // derived from aircraft if omitted
  enemyAircraft: AircraftId;
  enemyCount: number; // 1..8
  wingmen: number; // 0..3
  enemySkill: SkillLevel;
  wingmanSkill: SkillLevel;
  altitudeM: number;
  /** 'head-on' start, 'advantage' (player above & behind), 'disadvantage', 'random'. */
  startPosition: 'head-on' | 'advantage' | 'disadvantage' | 'random';
  timeOfDay: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk';
  cloudCover: number;
  type: 'dogfight' | 'balloon-attack' | 'escort' | 'intercept' | 'ground-attack';
  /** Optional historical ace to face, from src/data/aces.ts. */
  enemyAceId?: string;
  date?: string;
}
