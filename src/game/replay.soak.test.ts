/**
 * Flight-report replay (skipped unless REPLAY is set): flies a pasted flight report's mission
 * with the autoplayer at the report's realism settings, REPLAY_REPS times (default 8), and prints
 * the report's own outcome, one line per run, and the fairness soak's summary row.
 *
 *   REPLAY=playtests/<inbox or reports>/<file>.json [REPLAY_REPS=8] [REPLAY_MAXTIME=2400] \
 *     pnpm vitest run src/game/replay.soak.test.ts
 *
 * or `node tools/playtest/replay-report.mjs <file>.json [--reps N]`. Run 0 uses the game's own
 * seeds (a headless flight is deterministic, so it repeats exactly); runs 1.. reseed gun
 * dispersion, damage rolls and AI decisions (`seededHeadlessModules`), for a spread of outcomes
 * from the same start. The autoplayer is a veteran pilot, not the human who sent the report;
 * AUTOPLAY_PILOT=human flies it with the human-like aim instead (src/ai/humanAim.ts). Each run
 * prints the player's rounds and hits by mount (fixed guns / flexible rear gun) and the
 * aim-error median with the trigger held, and the last line totals them (the calibration
 * figures, docs/ai.md "Human-like pursuer").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { missionFromReport, parseFlightReport, realismFromReport } from '../core/flightReport';
import { runAutoplay, seededHeadlessModules, type AutoplayReport } from './autoplay';
import { FAIRNESS_HEADER, fairnessLine } from './autoplaySummary';
import { positiveIntEnv } from './testing/env';

const FILE = process.env.REPLAY ?? '';

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
function median(xs: number[]): string {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)].toFixed(2);
}
/** Quantile of a 1-degree histogram (seconds per bucket), deg; '-' when empty. */
function histQuantile(h: number[], q: number): string {
  const total = h.reduce((a, b) => a + b, 0);
  if (!total) return '-';
  let seen = 0;
  for (let i = 0; i < h.length; i++) {
    seen += h[i];
    if (seen >= q * total) return i === h.length - 1 ? `${i}+` : `${i + 0.5}`;
  }
  return '-';
}

describe.skipIf(!FILE)('flight report replay', () => {
  it('flies the report again', { timeout: 60 * 60 * 1000 }, () => {
    const REPS = positiveIntEnv('REPLAY_REPS', process.env.REPLAY_REPS, 8);
    const MAX_TIME = positiveIntEnv('REPLAY_MAXTIME', process.env.REPLAY_MAXTIME, 2400);
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
      const a = rep.aim;
      out.push(
        `  run ${r}: ${rep.result.playerFate} (${rep.result.playerOutcome}${rep.playerLossCause ? `, ${rep.playerLossCause}` : ''}), success ${rep.result.missionSuccess}, kills ${rep.playerKills}, enemy lost ${rep.enemyLosses}, ${rep.time.toFixed(0)} s${rep.timedOut ? ' TIMEOUT' : ''}` +
          ` | player ${a.playerHits}/${a.playerRoundsFired} crew ${a.crewHits}/${a.crewRoundsFired} all ${rep.result.hits}/${rep.result.roundsFired} | trigger err p50 ${histQuantile(a.triggerErrorDeg, 0.5)} deg | cone->shot p50 ${median(a.coneToShotS)} s (${a.coneToShotS.length}, no shot ${a.coneNoShot})`,
      );
    }
    const sum = (f: (x: AutoplayReport) => number) => runs.reduce((s, x) => s + f(x), 0);
    const hist = runs.reduce((h, x) => h.map((v, i) => v + x.aim.triggerErrorDeg[i]), new Array<number>(21).fill(0));
    const rangeHist = runs.reduce((h, x) => h.map((v, i) => v + x.aim.triggerRangeM[i]), new Array<number>(22).fill(0)).slice(0, 21);
    const rangeP50 = histQuantile(rangeHist, 0.5);
    const fr = sum((x) => x.aim.playerRoundsFired);
    const fh = sum((x) => x.aim.playerHits);
    const xr = sum((x) => x.aim.crewRoundsFired);
    const xh = sum((x) => x.aim.crewHits);
    out.push(
      `CALIB pilot=${runs[0]?.humanPilot ? 'human' : 'ai'} runs=${runs.length} player ${fh}/${fr} (${pct(fh, fr)}) crew ${xh}/${xr} (${pct(xh, xr)}) all ${sum((x) => x.result.hits)}/${sum((x) => x.result.roundsFired)} (${pct(sum((x) => x.result.hits), sum((x) => x.result.roundsFired))}) ` +
        `| per run: player rounds ${(fr / runs.length).toFixed(0)}, crew rounds ${(xr / runs.length).toFixed(0)} | trigger err p50 ${histQuantile(hist, 0.5)} p90 ${histQuantile(hist, 0.9)} deg | cone->shot p50 ${median(runs.flatMap((x) => x.aim.coneToShotS))} s | firing range p50 ${rangeP50 === '-' ? '-' : `${(parseFloat(rangeP50) * 50).toFixed(0)}${rangeP50.endsWith('+') ? '+' : ''}`} m`,
    );
    out.push(FAIRNESS_HEADER, fairnessLine(`replay ${report.mission.id}`.slice(0, 30), runs));
    process.stdout.write(out.join('\n') + '\n');
  });
});
