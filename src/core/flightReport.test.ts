import { describe, expect, it } from 'vitest';
import { runAutoplay } from '../game/autoplay';
import { recordedQuickFlight } from '../game/testing/recordedFlight';
import { buildFlightReport, FLIGHT_NOTE_MAX, missionFromReport, parseFlightReport, serializeFlightReport } from './flightReport';
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

  it('refuses things that are not a report, with a reason', () => {
    expect(() => parseFlightReport('nope')).toThrow(/Not JSON/);
    expect(() => parseFlightReport('{"kind":"other"}')).toThrow(/Not a flight report/);
    expect(() => parseFlightReport('{"kind":"rb2r-flight-report","schema":2}')).toThrow(/schema 2/);
    expect(() => parseFlightReport('{"kind":"rb2r-flight-report","schema":1}')).toThrow(/no usable mission/);
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
