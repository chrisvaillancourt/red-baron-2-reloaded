/**
 * Flight-report replay (skipped unless REPLAY is set): flies a pasted flight report's mission
 * with the autoplayer at the report's realism settings, REPLAY_REPS times (default 8), and prints
 * the report's own outcome, one line per run, and the fairness soak's summary row.
 *
 *   REPLAY=playtests/reports/<file>.json [REPLAY_REPS=8] [REPLAY_MAXTIME=2400] \
 *     pnpm vitest run src/game/replay.soak.test.ts
 *
 * or `node tools/playtest/replay-report.mjs <file>.json [--reps N]`. Run 0 uses the game's own
 * seeds (a headless flight is deterministic, so it repeats exactly); runs 1.. reseed gun
 * dispersion, damage rolls and AI decisions (`seededHeadlessModules`), for a spread of outcomes
 * from the same start. The autoplayer is a veteran pilot, not the human who sent the report.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { missionFromReport, parseFlightReport, realismFromReport } from '../core/flightReport';
import { runAutoplay, seededHeadlessModules, type AutoplayReport } from './autoplay';
import { FAIRNESS_HEADER, fairnessLine } from './autoplaySummary';

const FILE = process.env.REPLAY ?? '';
const REPS = Number(process.env.REPLAY_REPS ?? 8);
const MAX_TIME = Number(process.env.REPLAY_MAXTIME ?? 2400);

describe.skipIf(!FILE)('flight report replay', () => {
  it('flies the report again', { timeout: 60 * 60 * 1000 }, () => {
    const report = parseFlightReport(readFileSync(FILE, 'utf8'));
    const o = report.outcome;
    const out: string[] = [
      `replay ${FILE}: "${report.mission.title}", ${report.mission.date}, build ${report.build.sha}, ${report.settings.realism.flightModel} flight model, mouse ${report.settings.mouseMode}`,
      `reported: ${o.fate} (${o.playerOutcome}${o.lossCause ? `, ${o.lossCause}` : ''}), success ${o.missionSuccess}, hits ${o.hits}/${o.roundsFired}, hits taken ${o.hitsTaken ?? '-'}, ${o.flightTimeS.toFixed(0)} s, combat ${o.combatTimeS ?? '-'} s, rated ${report.rating ?? '-'}${report.note ? `: "${report.note}"` : ''}`,
    ];
    for (const e of report.enemies) {
      const p = e.firstPass;
      out.push(`  enemy ${e.callsign} (${e.skill}${e.aceId ? `, ${e.aceId}` : ''}) ${e.outcome}: ${p ? `first pass t=${p.t}s at ${p.atPlayer ? 'player' : 'another'} dh=${p.heightAdvM}m${p.above ? ' above' : ''}${p.upSun ? ' up-sun' : ''} ${p.seen === false ? 'unseen' : p.seen ? 'seen' : 'seen?'}` : 'never fired'}`);
    }
    const runs: AutoplayReport[] = [];
    for (let r = 0; r < REPS; r++) {
      const rep = runAutoplay(missionFromReport(report), { realism: realismFromReport(report), maxTime: MAX_TIME, modules: seededHeadlessModules(r) });
      expect(rep.badSpawns).toEqual([]);
      runs.push(rep);
      out.push(`  run ${r}: ${rep.result.playerFate} (${rep.result.playerOutcome}${rep.playerLossCause ? `, ${rep.playerLossCause}` : ''}), success ${rep.result.missionSuccess}, kills ${rep.playerKills}, enemy lost ${rep.enemyLosses}, ${rep.time.toFixed(0)} s${rep.timedOut ? ' TIMEOUT' : ''}`);
    }
    out.push(FAIRNESS_HEADER, fairnessLine(`replay ${report.mission.id}`.slice(0, 30), runs));
    process.stdout.write(out.join('\n') + '\n');
  });
});
