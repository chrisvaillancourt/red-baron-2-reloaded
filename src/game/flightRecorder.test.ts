import { describe, expect, it } from 'vitest';
import { buildQuickMission } from '../campaign';
import { DEFAULT_SETTINGS } from '../core/settings';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { headlessModules } from './autoplay';
import { FlightRecorder } from './flightRecorder';
import { SimCore } from './simCore';
import { recordedQuickFlight } from './testing/recordedFlight';

describe('flight recorder', () => {
  it('records hits taken, combat time and every enemy with its first pass', { timeout: 60_000 }, () => {
    const { mission, result, hitsOnPlayer, combatOnPlayerS } = recordedQuickFlight();
    const t = result.telemetry!;
    const enemyCount = mission.flights.filter((f) => f.role === 'enemy').reduce((n, f) => n + f.members.length, 0);
    expect(t.enemies).toHaveLength(enemyCount);
    expect(t.hitsTaken).toBe(hitsOnPlayer);
    // A head-on start 2.6 km apart: combat inside 1.5 km begins within the first minute.
    expect(t.combatTimeS).toBeGreaterThan(10);
    expect(t.combatTimeS).toBeLessThanOrEqual(result.flightTimeS + 0.1);
    // Matches an independent 10 Hz count of "alive, enemy within 1.5 km" to within a few samples.
    expect(Math.abs(t.combatTimeS - combatOnPlayerS)).toBeLessThan(0.5);
    const passes = t.enemies.flatMap((e) => (e.firstPass ? [e.firstPass] : []));
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.t).toBeGreaterThan(0);
      expect(p.above).toBe(p.heightAdvM > 100);
      // The AI-flown player has a perception to ask.
      if (p.atPlayer) expect(p.seen).not.toBeNull();
    }
    // Headless: no frames, no compression.
    expect(t.fps).toBeNull();
    expect(t.timeCompression).toEqual({ realS: 0, simS: 0, maxScale: 1 });
    // The loss cause is set exactly when the player didn't come home intact.
    const lost = result.playerOutcome !== 'in-flight' && result.playerOutcome !== 'landed-friendly' && result.playerOutcome !== 'disengaged';
    expect(t.lossCause !== null).toBe(lost);
  });

  it('reports frame rate percentiles and time compression from rendered frames', () => {
    const mission = buildQuickMission({ ...QUICK_DEFAULTS }, 1);
    const core = new SimCore(headlessModules, mission, () => DEFAULT_SETTINGS.realism);
    const rec = new FlightRecorder(core);
    for (let i = 0; i < 90; i++) rec.frame(1 / 60, 1 / 60, 1); // 90 frames at 60 fps
    for (let i = 0; i < 10; i++) rec.frame(1 / 20, 1 / 20, 4); // 10 slow frames at 4x
    const t = rec.telemetry();
    expect(t.fps!.frames).toBe(100);
    expect(t.fps!.p50).toBeGreaterThan(55);
    expect(t.fps!.p50).toBeLessThan(65);
    expect(t.fps!.p95).toBeGreaterThan(18);
    expect(t.fps!.p95).toBeLessThan(22);
    expect(t.timeCompression.maxScale).toBe(4);
    expect(t.timeCompression.realS).toBeCloseTo(0.5, 1);
    expect(t.timeCompression.simS).toBeCloseTo(2, 1);
    rec.dispose();
    core.dispose();
  });

  it('counts compression by the time the sim advanced, not a background-tab hitch', () => {
    const mission = buildQuickMission({ ...QUICK_DEFAULTS }, 1);
    const core = new SimCore(headlessModules, mission, () => DEFAULT_SETTINGS.realism);
    const rec = new FlightRecorder(core);
    // A 5 s hitch at 8x: the session clamps the step to 0.1 s, so the sim advanced 0.8 s.
    rec.frame(5, 0.1, 8);
    const t = rec.telemetry();
    expect(t.timeCompression.realS).toBeCloseTo(0.1, 5);
    expect(t.timeCompression.simS).toBeCloseTo(0.8, 5);
    // The fps histogram still sees the real 5 s frame (it lands in the slowest bucket).
    expect(t.fps!.p50).toBeLessThan(5);
    rec.dispose();
    core.dispose();
  });
});
