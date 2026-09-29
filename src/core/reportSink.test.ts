import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildQuickMission } from '../campaign';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { DEFAULT_SETTINGS } from './settings';
import type { MissionResult } from './types';
import { buildFlightReport, serializeFlightReport, type FlightReport } from './flightReport';
import { acceptFlightReport, REPORT_BODY_MAX, REPORT_SINK_PATH, reportFileName } from './reportSink';

function report(over: Partial<FlightReport> = {}): FlightReport {
  const mission = buildQuickMission({ ...QUICK_DEFAULTS }, 7);
  const result = {
    missionId: mission.id, playerFate: 'returned', playerOutcome: 'landed-friendly', missionSuccess: true, endedByPlayer: false,
    objectives: [], claims: [], enemyLosses: 2, friendlyLosses: [], roundsFired: 300, hits: 40, flightTimeS: 300,
  } as unknown as MissionResult;
  const r = buildFlightReport({ mission, result, settings: DEFAULT_SETTINGS, quickOptions: { ...QUICK_DEFAULTS }, build: { sha: 'abc1234', builtAt: '2026-09-28T00:00:00Z', dev: true }, now: new Date('2026-09-29T00:52:21.031Z') });
  return { ...r, ...over };
}

describe('flight report sink (dev server)', () => {
  it('names a report by when it was made and what was flown, so re-saves overwrite it', () => {
    expect(reportFileName(report())).toBe('2026-09-29-005221-dogfight-sopwith-camel-v-2-fokker-dvii.json');
    // Rating and note don't change the name: the debrief re-sends the same flight.
    expect(reportFileName(report({ rating: 'fair', note: 'x' }))).toBe(reportFileName(report()));
  });

  it('writes a valid report and answers with its name', () => {
    const writes: [string, string][] = [];
    const res = acceptFlightReport(serializeFlightReport(report()), (name, text) => writes.push([name, text]));
    expect(res.status).toBe(200);
    expect(res.body.file).toBe('2026-09-29-005221-dogfight-sopwith-camel-v-2-fokker-dvii.json');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1]).kind).toBe('rb2r-flight-report');
  });

  it('refuses anything that is not a flight report, without writing', () => {
    const writes: string[] = [];
    const write = (name: string) => writes.push(name);
    expect(acceptFlightReport('not json', write).status).toBe(400);
    expect(acceptFlightReport(JSON.stringify({ kind: 'other' }), write).status).toBe(400);
    expect(acceptFlightReport('x'.repeat(REPORT_BODY_MAX + 1), write).status).toBe(413);
    expect(writes).toEqual([]);
  });

  it('keeps the file name to safe characters whatever the report says', () => {
    const r = report();
    r.mission.type = '../../etc/passwd' as never;
    r.createdAt = '../../2026';
    const name = reportFileName(r);
    expect(name).toMatch(/^[a-z0-9-]+\.json$/);
    expect(name).not.toContain('..');
  });

  it('vite.config.ts serves the sink at the path the debrief posts to', () => {
    // The config keeps its own copy so it imports nothing from src (it loads this module via Vite).
    expect(readFileSync('vite.config.ts', 'utf8')).toContain(`const REPORT_SINK_PATH = '${REPORT_SINK_PATH}';`);
  });
});
