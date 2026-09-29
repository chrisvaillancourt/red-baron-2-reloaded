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
 * AI_TACTICS=escalateDefence=0 switches the escalating defence off for an A/B run.
 */
import { describe, it } from 'vitest';
import { applyTacticsFlagsFromEnv } from './tactics';
import { buildQuickMission } from '../campaign';
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftEntity, AircraftId } from '../core/types';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { headlessModules } from '../game/autoplay';
import { SimCore, SIM_HZ } from '../game/simCore';
import { DEFAULT_SETTINGS } from '../core/settings';
import { TailHoldTracker, tailHoldLine, type TailHoldAcc } from './testing/tailHold';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
applyTacticsFlagsFromEnv(process.env);
const REPS = Number(process.env.AI_TH_REPS ?? 12);
const SET = process.env.AI_TH_SET ?? 'default';
const MAX_T = Number(process.env.AI_TH_MAXTIME ?? 600);

type Setup = QuickMissionOptions & { label: string };
const base = (player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): Setup => ({
  label: `${player} v ${enemy}`,
  type: 'dogfight', playerAircraft: player, enemyAircraft: enemy, enemyCount: 2, wingmen: 1,
  enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35,
  ...extra,
});
const SETS: Record<string, Setup[]> = {
  default: [{ ...QUICK_DEFAULTS, label: 'default (quick screen)' }],
  mirror: [base('sopwith_camel', 'sopwith_camel'), base('fokker_dvii', 'fokker_dvii')],
  energy: [base('sopwith_camel', 'fokker_dvii'), base('fokker_dvii', 'sopwith_camel')],
  low: [
    {
      ...base('bristol_f2b', 'fokker_dvii', { enemyCount: 5, wingmen: 3, enemySkill: 'ace', wingmanSkill: 'novice', altitudeM: 300, timeOfDay: 'dusk', cloudCover: 0.2 }),
      label: 'report: brisfit+3 v 5 ace d.vii 300 m',
    },
  ],
};

describe.skipIf(!SOAK.includes('tailhold'))('tail-hold survey', () => {
  it('reports how defenders deal with an enemy on their tail', () => {
    const lines: string[] = [`tailhold set=${SET} reps=${REPS} AI_TACTICS=${process.env.AI_TACTICS ?? '(default)'}`];
    for (const s of SET.split(',').flatMap((k) => SETS[k] ?? [])) {
      const acc = new Map<string, TailHoldAcc>();
      const crashes = new Map<string, number>();
      let playerCrash = 0;
      let playerDown = 0;
      for (let r = 0; r < REPS; r++) {
        const m = buildQuickMission(s, 5000 + r * 131);
        const core = new SimCore(headlessModules, m, () => DEFAULT_SETTINGS.realism, { aiPlayer: true });
        const pl = core.world.player!;
        const key = (a: AircraftEntity) => `${a.side === pl.side ? 'P' : 'E'}:${a.spec.shortName}:${a.skill}${a === pl ? '(pl)' : ''}`;
        const tr = new TailHoldTracker(
          () => core.world.aircraft,
          (a) => (core.ai.get(a.id) as unknown as { debugState?: string } | undefined)?.debugState ?? '',
          (a) => key(a),
          acc,
        );
        core.bus.onAny((e) => {
          if (e.type === 'bullet-hit') tr.onHit(e.targetId);
        });
        const h = 1 / SIM_HZ;
        let tick = 0;
        while (!core.director.ended && core.world.time < MAX_T) {
          core.step(h);
          if (++tick % 12) continue;
          tr.sample(12 * h);
        }
        for (const a of core.world.aircraft) {
          if (a.outcome !== 'crashed') continue;
          const k = `${a.side === pl.side ? 'P' : 'E'}${a === pl ? '(pl)' : ''}`;
          crashes.set(k, (crashes.get(k) ?? 0) + 1);
        }
        if (pl.outcome === 'crashed') playerCrash++;
        if (pl.outcome && pl.outcome !== 'landed-friendly') playerDown++;
      }
      lines.push(`== ${s.label} (${REPS} runs): player down ${playerDown}, player crashed ${playerCrash}, crashes ${[...crashes].map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
      for (const [k, g] of [...acc].sort()) lines.push('  ' + tailHoldLine(k, g, REPS));
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
