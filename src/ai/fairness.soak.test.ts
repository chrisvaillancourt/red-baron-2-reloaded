/**
 * Quick-dogfight fairness survey (AI_SOAK=fairness). Flies seeded quick dogfights between
 * pairs of fighters with the autoplayer and reports, per matchup, the player's fate and
 * the player side's share of all aircraft lost (0.5 = an even exchange).
 *
 *   AI_SOAK=fairness AI_FAIR_REPS=24 AI_FAIR_SET=default pnpm vitest run src/ai/fairness.soak.test.ts
 *
 * AI_FAIR_SET: `default` (the Quick Mission screen's setup), `mirror` (same type and skill
 * both sides: checks the AI itself is even), `matrix` (common 1917-18 matchups), `survey`
 * (the autoplay survey's quick setups), `vet` (Camel against veteran D.Vs and Dr.Is), `twoseat`
 * (a Bristol F.2b against D.Vs, a D.VII against R.E.8s: rear gunners on both sides), `dvii` / `dviiground` (the wave-9 default candidates). AI_FAIR_SKILL forces every pilot, player included,
 * to one skill.
 */
import { describe, it } from 'vitest';
import { applyTacticsFlagsFromEnv } from './tactics';
import { buildQuickMission } from '../campaign';
import type { SkillLevel } from '../core/types';
import { runAutoplay, type AutoplayReport } from '../game/autoplay';
import { FAIRNESS_HEADER, fairnessLine } from '../game/autoplaySummary';
import { positiveIntEnv, selectSets } from '../game/testing/env';
import { FAIRNESS_SETS } from './testing/surveySets';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
// AI_TACTICS=boomZoomOutTurned=1,stalk=0,... flips src/ai/tactics.ts TACTICS_FLAGS for A/B runs.
applyTacticsFlagsFromEnv(process.env);
const REPS = positiveIntEnv('AI_FAIR_REPS', process.env.AI_FAIR_REPS, 16);
const SET = process.env.AI_FAIR_SET ?? 'default';
const FORCE = process.env.AI_FAIR_SKILL as SkillLevel | undefined;
/** Only setups whose label contains this substring. */
const ONLY = process.env.AI_FAIR_ONLY ?? '';

describe.skipIf(!SOAK.includes('fairness'))('quick dogfight fairness', () => {
  it('reports player fate and exchange per matchup', () => {
    const setups = selectSets('AI_FAIR_SET', SET, FAIRNESS_SETS).filter((s) => s.label.includes(ONLY));
    if (!setups.length) throw new Error(`AI_FAIR_ONLY=${JSON.stringify(ONLY)} matches no setup in AI_FAIR_SET=${SET}.`);
    const lines: string[] = [`fairness set=${SET} reps=${REPS}${FORCE ? ` skill=${FORCE}` : ''}`];
    lines.push(FAIRNESS_HEADER);
    for (const s of setups) {
      const runs: AutoplayReport[] = [];
      for (let r = 0; r < REPS; r++) {
        const m = buildQuickMission(s, 5000 + r * 131);
        if (FORCE) for (const f of m.flights) for (const mem of f.members) mem.skill = FORCE;
        runs.push(runAutoplay(m, { maxTime: 1500 }));
      }
      lines.push(fairnessLine(s.label, runs));
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
