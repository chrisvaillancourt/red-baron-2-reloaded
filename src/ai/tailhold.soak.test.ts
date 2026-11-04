/**
 * Tail-hold survey (AI_SOAK=tailhold): flies seeded quick dogfights and reports, per
 * defender type and side, how long an enemy held its tail (inside 400 m, within 60 deg of
 * dead astern) and what it did meanwhile: time in a sustained flat circle, mean bank,
 * height change, AI state. Also counts ground impacts (crashes) per side, because
 * low-level fights can drag the pursuer into the ground.
 *
 *   AI_SOAK=tailhold AI_TH_REPS=12 AI_TH_SET=default,low pnpm vitest run src/ai/tailhold.soak.test.ts
 *
 * AI_TH_SET: `default` (the Quick Mission screen's setup), `mirror` (Camel and D.VII
 * mirrors), `energy` (Camel v D.VII both ways), `low` (the wave-9 playtest report: a
 * Bristol and 3 novice wingmen against 5 ace D.VIIs head-on at 300 m, dusk).
 * AI_TACTICS=escalateDefence=0 switches the escalating defence off for an A/B run
 * (defenceLadder=1: the ladder). AUTOPLAY_PILOT=human flies the player's aircraft with the
 * human-like aim (humanAim.ts); the `vs player` lines count only tail-holds by the player.
 */
import { describe, it } from 'vitest';
import { applyTacticsFlagsFromEnv } from './tactics';
import { buildQuickMission } from '../campaign';
import type { AircraftEntity } from '../core/types';
import { headlessModules } from '../game/autoplay';
import { SimCore, SIM_HZ } from '../game/simCore';
import { DEFAULT_SETTINGS } from '../core/settings';
import { finiteEnv, positiveIntEnv, selectSets } from '../game/testing/env';
import { humanPilotFromEnv } from './humanAim';
import { TAILHOLD_SETS } from './testing/surveySets';
import { TailHoldTracker, tailHoldLine, type TailHoldAcc } from './testing/tailHold';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
applyTacticsFlagsFromEnv(process.env);
const REPS = positiveIntEnv('AI_TH_REPS', process.env.AI_TH_REPS, 36);
const SET = process.env.AI_TH_SET ?? 'default';
const MAX_T = finiteEnv('AI_TH_MAXTIME', process.env.AI_TH_MAXTIME, 600);
const HUMAN = humanPilotFromEnv(process.env);

describe.skipIf(!SOAK.includes('tailhold'))('tail-hold survey', () => {
  it('reports how defenders deal with an enemy on their tail', () => {
    const lines: string[] = [`tailhold set=${SET} reps=${REPS} AI_TACTICS=${process.env.AI_TACTICS ?? '(default)'} player=${HUMAN ? 'human-like' : 'veteran'}`];
    for (const s of selectSets('AI_TH_SET', SET, TAILHOLD_SETS)) {
      const acc = new Map<string, TailHoldAcc>();
      const accP = new Map<string, TailHoldAcc>();
      let pFixed = 0;
      let pFixedHits = 0;
      const crashes = new Map<string, number>();
      let playerCrash = 0;
      let playerDown = 0;
      for (let r = 0; r < REPS; r++) {
        const m = buildQuickMission(s, 5000 + r * 131);
        const core = new SimCore(headlessModules, m, () => DEFAULT_SETTINGS.realism, { aiPlayer: true, humanPlayer: HUMAN });
        const pl = core.world.player!;
        const key = (a: AircraftEntity) => `${a.side === pl.side ? 'P' : 'E'}:${a.spec.shortName}:${a.skill}${a === pl ? '(pl)' : ''}`;
        const tr = new TailHoldTracker(
          () => core.world.aircraft,
          (a) => (core.ai.get(a.id) as unknown as { debugState?: string } | undefined)?.debugState ?? '',
          (a) => key(a),
          acc,
        );
        const trP = new TailHoldTracker(
          () => core.world.aircraft,
          (a) => (core.ai.get(a.id) as unknown as { debugState?: string } | undefined)?.debugState ?? '',
          (a) => (a.side === pl.side ? null : `${key(a)} vs player`),
          accP,
          (h) => h === pl,
        );
        const fixedMount = (i: number | undefined) => pl.spec.guns[i ?? 0]?.mount !== 'flexible';
        core.bus.onAny((e) => {
          if (e.type === 'bullet-hit') {
            tr.onHit(e.targetId);
            trP.onHit(e.targetId);
            if (e.shooterId === pl.id && fixedMount(e.mountIndex)) pFixedHits++;
          }
          if (e.type === 'gun-fired' && e.shooterId === pl.id && fixedMount(e.mountIndex)) pFixed++;
        });
        const h = 1 / SIM_HZ;
        let tick = 0;
        while (!core.director.ended && core.world.time < MAX_T) {
          core.step(h);
          if (++tick % 12) continue;
          tr.sample(12 * h);
          trP.sample(12 * h);
        }
        tr.finish();
        trP.finish();
        for (const a of core.world.aircraft) {
          if (a.outcome !== 'crashed') continue;
          const k = `${a.side === pl.side ? 'P' : 'E'}${a === pl ? '(pl)' : ''}`;
          crashes.set(k, (crashes.get(k) ?? 0) + 1);
        }
        if (pl.outcome === 'crashed') playerCrash++;
        if (pl.outcome && pl.outcome !== 'landed-friendly') playerDown++;
      }
      lines.push(
        `== ${s.label} (${REPS} runs): player down ${playerDown}, player crashed ${playerCrash}, crashes ${[...crashes].map(([k, v]) => `${k} ${v}`).join(', ') || '-'}, player fixed guns ${pFixedHits}/${pFixed} (${pFixed ? ((100 * pFixedHits) / pFixed).toFixed(1) : '-'}%)`,
      );
      for (const [k, g] of [...acc].sort()) lines.push('  ' + tailHoldLine(k, g, REPS));
      for (const [k, g] of [...accP].sort()) lines.push('  ' + tailHoldLine(k, g, REPS));
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
