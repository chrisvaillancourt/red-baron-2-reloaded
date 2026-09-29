import { describe, expect, it } from 'vitest';
import { runAutoplay } from '../game/autoplay';
import { recordedQuickFlight } from '../game/testing/recordedFlight';
import { buildFlightReport, FLIGHT_NOTE_MAX, missionFromReport, parseFlightReport, realismFromReport, serializeFlightReport } from './flightReport';
import { DEFAULT_SETTINGS } from './settings';
import type { MissionDefinition, MissionResult } from './types';

const BUILD = { sha: 'abc1234', builtAt: '2026-09-28T12:00:00.000Z' };

describe('flight report', () => {
  it('round-trips: the parsed report rebuilds the same mission, and it flies the same', { timeout: 60_000 }, () => {
    const first = recordedQuickFlight(5131, 400);
    const report = buildFlightReport({
      mission: first.mission,
      result: first.result,
      settings: DEFAULT_SETTINGS,
      quickOptions: first.options,
      rating: 'fair',
      note: '  Lost him in the cloud.  ',
      build: BUILD,
      now: new Date('2026-09-28T13:00:00Z'),
    });
    const parsed = parseFlightReport(serializeFlightReport(report));
    expect(parsed).toEqual(report);
    const mission = missionFromReport(parsed);
    expect(mission).toEqual(first.mission);
    expect(mission).not.toBe(first.mission);

    // The outcome and telemetry made it in.
    expect(parsed.schema).toBe(1);
    expect(parsed.note).toBe('Lost him in the cloud.');
    expect(parsed.quickOptions).toEqual(first.options);
    expect(parsed.outcome.hitsTaken).toBe(first.hitsOnPlayer);
    expect(parsed.enemies).toHaveLength(first.result.telemetry!.enemies.length);
    expect(parsed.outcome.objectives.length).toBe(first.mission.objectives.length);

    // A headless sim is deterministic, so the rebuilt mission flies the same fight again
    // (one with shooting in it, or the comparison proves nothing).
    expect(first.result.hits).toBeGreaterThan(0);
    const replay = replayMission(mission);
    expect(replay.playerFate).toBe(first.result.playerFate);
    expect(replay.hits).toBe(first.result.hits);
    expect(replay.enemyLosses).toBe(first.result.enemyLosses);
    expect(replay.flightTimeS).toBeCloseTo(first.result.flightTimeS, 6);
  });

  it('keeps notes short and ratings optional', () => {
    const { mission, result } = { mission: { objectives: [] } as never, result: minimalResult() };
    const r = buildFlightReport({ mission, result, settings: DEFAULT_SETTINGS, note: 'x'.repeat(FLIGHT_NOTE_MAX + 50), build: BUILD });
    expect(r.note).toHaveLength(FLIGHT_NOTE_MAX);
    expect(r.rating).toBeNull();
    expect(r.enemies).toEqual([]);
    expect(r.performance).toBeNull();
    expect(r.outcome.hitsTaken).toBeNull();
  });

  it('carries the bomb counts of a bombing sortie, and leaves them out otherwise', () => {
    const mission = { objectives: [], flights: [], date: '1918-08-06' } as never;
    const bombed = buildFlightReport({ mission, result: { ...minimalResult(), bombsDropped: 4, bombHits: 1 }, settings: DEFAULT_SETTINGS, build: BUILD });
    expect(bombed.outcome).toMatchObject({ bombsDropped: 4, bombHits: 1 });
    expect(parseFlightReport(serializeFlightReport(bombed)).outcome.bombsDropped).toBe(4);
    const plain = buildFlightReport({ mission, result: minimalResult(), settings: DEFAULT_SETTINGS, build: BUILD });
    expect('bombsDropped' in plain.outcome).toBe(false);
    expect('bombHits' in plain.outcome).toBe(false);
  });

  it('carries the time at each crew station of a two-seater, and leaves it out otherwise', () => {
    const mission = { objectives: [], flights: [], date: '1918-08-06' } as never;
    const base = minimalResult();
    const telemetry = { hitsTaken: 0, lossCause: null, combatTimeS: 0, timeCompression: { realS: 0, simS: 0, maxScale: 1 }, fps: null, enemies: [] };
    const crewed = buildFlightReport({ mission, result: { ...base, telemetry: { ...telemetry, stationTimeS: { pilot: 60, observer: 40.5 } } }, settings: DEFAULT_SETTINGS, build: BUILD });
    expect(crewed.outcome.stationTimeS).toEqual({ pilot: 60, observer: 40.5 });
    expect(parseFlightReport(serializeFlightReport(crewed)).outcome.stationTimeS).toEqual({ pilot: 60, observer: 40.5 });
    const solo = buildFlightReport({ mission, result: { ...base, telemetry }, settings: DEFAULT_SETTINGS, build: BUILD });
    expect('stationTimeS' in solo.outcome).toBe(false);
  });

  it('refuses things that are not a report, with a reason', () => {
    expect(() => parseFlightReport('nope')).toThrow(/Not JSON/);
    expect(() => parseFlightReport('{"kind":"other"}')).toThrow(/Not a flight report/);
    expect(() => parseFlightReport('{"kind":"rb2r-flight-report","schema":2}')).toThrow(/schema 2/);
    expect(() => parseFlightReport('{"kind":"rb2r-flight-report","schema":1}')).toThrow(/no usable mission/);
    // A report that has lost a section says which.
    const good = buildFlightReport({ mission: { objectives: [], flights: [], date: '1918-08-06' } as never, result: minimalResult(), settings: DEFAULT_SETTINGS, build: BUILD });
    const without = (k: string) => JSON.stringify({ ...good, [k]: undefined });
    expect(() => parseFlightReport(serializeFlightReport(good))).not.toThrow();
    expect(() => parseFlightReport(without('outcome'))).toThrow(/no outcome/);
    expect(() => parseFlightReport(without('build'))).toThrow(/no build/);
    expect(() => parseFlightReport(without('enemies'))).toThrow(/no enemies list/);
    expect(() => parseFlightReport(JSON.stringify({ ...good, enemies: {} }))).toThrow(/no enemies list/);
    expect(() => parseFlightReport(JSON.stringify({ ...good, outcome: { ...good.outcome, fate: undefined } }))).toThrow(/outcome.*fate/);
  });

  it('replays at the report realism, with defaults for fields it predates', () => {
    const r = buildFlightReport({ mission: { objectives: [] } as never, result: minimalResult(), settings: DEFAULT_SETTINGS, build: BUILD });
    const old = { ...r.settings.realism, flightModel: 'authentic' } as Record<string, unknown>;
    delete old.enemySkillBias; // as if written before the field existed
    const realism = realismFromReport({ ...r, settings: { ...r.settings, realism: old as never } });
    expect(realism.flightModel).toBe('authentic');
    expect(realism.enemySkillBias).toBe(DEFAULT_SETTINGS.realism.enemySkillBias);
  });
});

/** Fly a mission again with the recordedQuickFlight rules (400 s cap, no end-flight shortcut). */
function replayMission(m: MissionDefinition): MissionResult {
  return runAutoplay(m, { maxTime: 400, endFlightWhenSafe: false }).result;
}

function minimalResult(): MissionResult {
  return {
    missionId: 'm',
    playerFate: 'returned',
    playerOutcome: 'in-flight',
    endedByPlayer: true,
    claims: [],
    objectives: [],
    missionSuccess: true,
    friendlyLosses: [],
    enemyLosses: 0,
    flightTimeS: 12.34,
    roundsFired: 0,
    hits: 0,
    wingmanClaims: [],
  };
}
