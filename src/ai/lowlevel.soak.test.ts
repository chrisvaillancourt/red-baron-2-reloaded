/**
 * Low-altitude fight survey (AI_SOAK=lowlevel): the defended ground-attack case.
 *   AI_SOAK=lowlevel AI_SEEDS=6 AI_OUT=/tmp/ll.txt pnpm vitest run src/ai/lowlevel.soak.test.ts
 * Reports per matchup: A/B losses, ground impacts of flyable aircraft, and the share
 * of engage time each side spends in stall recovery (plus seconds actually stalled).
 */
import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { AircraftId, SkillLevel } from '../core/types';
import { lowLevelRun } from './testing/realScenarios';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const SEEDS = Number(process.env.AI_SEEDS ?? 6);

const MATCHUPS: { a: AircraftId; sa: SkillLevel; b: AircraftId; sb: SkillLevel; n: [number, number]; kind: 'bounce' | 'level' }[] = [
  { a: 'sopwith_camel', sa: 'veteran', b: 'fokker_dri', sb: 'regular', n: [3, 3], kind: 'bounce' },
  { a: 'fokker_dvii', sa: 'veteran', b: 'spad_xiii', sb: 'veteran', n: [2, 2], kind: 'bounce' },
  { a: 'se5a', sa: 'veteran', b: 'albatros_dv', sb: 'regular', n: [2, 2], kind: 'bounce' },
  { a: 'sopwith_camel', sa: 'veteran', b: 'fokker_dri', sb: 'regular', n: [1, 1], kind: 'level' },
  { a: 'spad_xiii', sa: 'regular', b: 'fokker_dvii', sb: 'regular', n: [2, 2], kind: 'level' },
];

describe.skipIf(!SOAK.includes('lowlevel'))('soak: low-level fights', () => {
  it('survey', () => {
    const rows: string[] = [];
    const tot = { aLost: 0, bLost: 0, nA: 0, nB: 0, self: 0, ground: 0, engA: 0, recA: 0, engB: 0, recB: 0, stalled: 0 };
    const pct = (x: number, y: number) => `${y > 0 ? ((100 * x) / y).toFixed(1) : '-'}%`;
    for (const m of MATCHUPS) {
      const t = { aLost: 0, bLost: 0, self: 0, ground: 0, engA: 0, recA: 0, engB: 0, recB: 0, stA: 0, stB: 0 };
      for (let s = 1; s <= SEEDS; s++) {
        const r = lowLevelRun({ ...m, seed: s });
        t.aLost += r.aLost;
        t.bLost += r.bLost;
        t.self += r.selfCrashes;
        t.ground += r.groundImpacts;
        t.engA += r.statsA.engage;
        t.recA += r.statsA.engageRecover;
        t.engB += r.statsB.engage;
        t.recB += r.statsB.engageRecover;
        t.stA += r.statsA.stalled;
        t.stB += r.statsB.stalled;
      }
      rows.push(
        `${m.kind.padEnd(6)} ${m.n.join('v')} ${m.a}/${m.sa} vs ${m.b}/${m.sb}: A lost ${t.aLost}/${m.n[0] * SEEDS} B lost ${t.bLost}/${m.n[1] * SEEDS} | self-crash ${t.self} ground-impacts ${t.ground} | recover A ${pct(t.recA, t.engA)} B ${pct(t.recB, t.engB)} | stalled A ${t.stA.toFixed(0)}s B ${t.stB.toFixed(0)}s`,
      );
      tot.aLost += t.aLost;
      tot.bLost += t.bLost;
      tot.nA += m.n[0] * SEEDS;
      tot.nB += m.n[1] * SEEDS;
      tot.self += t.self;
      tot.ground += t.ground;
      tot.engA += t.engA;
      tot.recA += t.recA;
      tot.engB += t.engB;
      tot.recB += t.recB;
      tot.stalled += t.stA + t.stB;
    }
    rows.push(
      `TOTAL A lost ${tot.aLost}/${tot.nA} B lost ${tot.bLost}/${tot.nB} | self-crash ${tot.self} ground-impacts ${tot.ground} | recover A ${pct(tot.recA, tot.engA)} B ${pct(tot.recB, tot.engB)} | stalled ${tot.stalled.toFixed(0)}s`,
    );
    const text = '\n' + rows.join('\n') + '\n';
    if (process.env.AI_OUT) appendFileSync(process.env.AI_OUT, text);
    else process.stdout.write(text);
  }, 3_600_000);
});
