/**
 * The flight report: one flight as versioned JSON, built on the debrief ("Copy flight report")
 * and replayed by tools/playtest/replay-report.mjs (DECISIONS "Flight reports"). It carries the
 * full MissionDefinition, so career missions reproduce as well as quick ones, plus the settings
 * that change a fight, the outcome, the flight recorder's telemetry and the player's rating.
 *
 * Personal data: the pilot's name only (career), and the generated names inside the mission.
 * Schema changes: add optional fields freely; anything else bumps `schema` and teaches
 * `parseFlightReport` to read the old one.
 */
import type { CareerDifficulty, QuickMissionOptions } from './campaignTypes';
import type { BuildInfo } from './build';
import { DEFAULT_SETTINGS } from './settings';
import type {
  AimTelemetry,
  AircraftOutcome,
  ControlSettings,
  EnemyEntryTelemetry,
  FlightTelemetry,
  GameSettings,
  GraphicsQuality,
  MissionDefinition,
  MissionResult,
  PilotFate,
  RealismSettings,
  VictoryClaim,
} from './types';

export const FLIGHT_REPORT_KIND = 'rb2r-flight-report';
export const FLIGHT_REPORT_SCHEMA = 1;
/** Longest note kept, characters. */
export const FLIGHT_NOTE_MAX = 1000;

export type FlightRating = 'too-easy' | 'fair' | 'too-hard';
export const FLIGHT_RATINGS: readonly FlightRating[] = ['too-easy', 'fair', 'too-hard'];

export interface FlightReport {
  kind: typeof FLIGHT_REPORT_KIND;
  schema: typeof FLIGHT_REPORT_SCHEMA;
  /** When the report was made (ISO). */
  createdAt: string;
  /**
   * The build that flew it: git short SHA ("-dirty" with local changes) and build time. `dev`:
   * from the dev server, so the SHA is as of server start (src/core/build.ts).
   */
  build: BuildInfo;
  /** The career pilot's name; null for a quick mission. */
  pilot: string | null;
  rating: FlightRating | null;
  note: string;
  settings: {
    realism: RealismSettings;
    mouseMode: ControlSettings['mouseMode'];
    graphics: GraphicsQuality;
    /** Career difficulty; null for a quick mission. */
    careerDifficulty: CareerDifficulty | null;
  };
  mission: MissionDefinition;
  /** The Quick Mission screen's options, when it was one. */
  quickOptions: QuickMissionOptions | null;
  outcome: {
    fate: PilotFate;
    playerOutcome: AircraftOutcome | 'in-flight';
    missionSuccess: boolean;
    aborted: boolean;
    endedByPlayer: boolean;
    lossCause: string | null;
    objectives: { id: string; description: string; primary: boolean; completed: boolean }[];
    claims: VictoryClaim[];
    enemyLosses: number;
    friendlyLosses: { name: string; fate: PilotFate }[];
    roundsFired: number;
    hits: number;
    hitsTaken: number | null;
    flightTimeS: number;
    combatTimeS: number | null;
    /** A bombing sortie's `MissionResult.bombsDropped` / `bombHits`; absent for any other (additive, schema 1). */
    bombsDropped?: number;
    bombHits?: number;
  };
  /** Each enemy aircraft and its first firing pass (empty without telemetry). */
  enemies: EnemyEntryTelemetry[];
  timeCompression: FlightTelemetry['timeCompression'] | null;
  performance: FlightTelemetry['fps'];
  /**
   * The player's gunnery: rounds and hits by mount (`outcome.hits` includes a two-seater's
   * AI-aimed rear gun), the aim-error histogram with the trigger held, and the time from a
   * target entering the gun line's 10-degree cone to the first shot. Absent from older reports.
   */
  aim?: AimTelemetry | null;
}

export interface FlightReportInput {
  mission: MissionDefinition;
  result: MissionResult;
  settings: GameSettings;
  quickOptions?: QuickMissionOptions | null;
  pilot?: string | null;
  careerDifficulty?: CareerDifficulty | null;
  rating?: FlightRating | null;
  note?: string;
  build: BuildInfo;
  now?: Date;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildFlightReport(i: FlightReportInput): FlightReport {
  const { mission, result } = i;
  const t = result.telemetry;
  return {
    kind: FLIGHT_REPORT_KIND,
    schema: FLIGHT_REPORT_SCHEMA,
    createdAt: (i.now ?? new Date()).toISOString(),
    build: { ...i.build },
    pilot: i.pilot ?? null,
    rating: i.rating ?? null,
    note: (i.note ?? '').trim().slice(0, FLIGHT_NOTE_MAX),
    settings: {
      realism: clone(i.settings.realism),
      mouseMode: i.settings.controls.mouseMode,
      graphics: i.settings.graphics,
      careerDifficulty: i.careerDifficulty ?? null,
    },
    mission: clone(mission),
    quickOptions: i.quickOptions ? clone(i.quickOptions) : null,
    outcome: {
      fate: result.playerFate,
      playerOutcome: result.playerOutcome,
      missionSuccess: result.missionSuccess,
      aborted: !!result.aborted,
      endedByPlayer: result.endedByPlayer,
      lossCause: t?.lossCause ?? null,
      objectives: mission.objectives.map((o) => ({
        id: o.id,
        description: o.description,
        primary: o.primary,
        completed: !!result.objectives.find((r) => r.id === o.id)?.completed,
      })),
      claims: clone(result.claims),
      enemyLosses: result.enemyLosses,
      friendlyLosses: result.friendlyLosses.map((l) => ({ name: l.name, fate: l.fate })),
      roundsFired: result.roundsFired,
      hits: result.hits,
      hitsTaken: t?.hitsTaken ?? null,
      flightTimeS: r1(result.flightTimeS),
      combatTimeS: t?.combatTimeS ?? null,
      ...(result.bombsDropped !== undefined ? { bombsDropped: result.bombsDropped, bombHits: result.bombHits ?? 0 } : {}),
    },
    enemies: t ? clone(t.enemies) : [],
    timeCompression: t ? { ...t.timeCompression } : null,
    performance: t?.fps ? { ...t.fps } : null,
    aim: t?.aim ? clone(t.aim) : null,
  };
}

export function serializeFlightReport(r: FlightReport): string {
  return JSON.stringify(r, null, 2);
}

/** Read a pasted report; throws an Error saying what is wrong with it. */
export function parseFlightReport(text: string): FlightReport {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not JSON: ${(e as Error).message}`);
  }
  const r = v as Partial<FlightReport> | null;
  if (!r || typeof r !== 'object') throw new Error('Not a flight report: expected a JSON object.');
  if (r.kind !== FLIGHT_REPORT_KIND) throw new Error(`Not a flight report: kind is ${JSON.stringify(r.kind)}, expected "${FLIGHT_REPORT_KIND}".`);
  if (r.schema !== FLIGHT_REPORT_SCHEMA) throw new Error(`Unsupported flight report schema ${JSON.stringify(r.schema)} (this build reads ${FLIGHT_REPORT_SCHEMA}).`);
  const m = r.mission as Partial<MissionDefinition> | undefined;
  if (!m || typeof m !== 'object' || !Array.isArray(m.flights) || typeof m.date !== 'string') throw new Error('Flight report has no usable mission.');
  if (!isObject(r.settings) || !isObject(r.settings.realism)) throw new Error('Flight report has no realism settings.');
  if (!isObject(r.build) || typeof r.build.sha !== 'string') throw new Error('Flight report has no build (expected build.sha).');
  if (!isObject(r.outcome)) throw new Error('Flight report has no outcome.');
  for (const [k, type] of [['fate', 'string'], ['missionSuccess', 'boolean'], ['flightTimeS', 'number']] as const) {
    if (typeof r.outcome[k] !== type) throw new Error(`Flight report outcome has no ${k} (expected a ${type}).`);
  }
  if (!Array.isArray(r.outcome.objectives)) throw new Error('Flight report outcome has no objectives list.');
  if (!Array.isArray(r.enemies)) throw new Error('Flight report has no enemies list.');
  return r as FlightReport;
}

function isObject(v: unknown): v is Record<string, unknown> & object {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The mission to fly again: a fresh copy of the one in the report. */
export function missionFromReport(r: FlightReport): MissionDefinition {
  return clone(r.mission);
}

/**
 * The realism to fly a report again with: the report's settings over the current defaults, so a
 * field added after the report was written (allowed under schema 1) gets its default.
 */
export function realismFromReport(r: FlightReport, defaults: RealismSettings = DEFAULT_SETTINGS.realism): RealismSettings {
  return { ...defaults, ...r.settings.realism };
}
