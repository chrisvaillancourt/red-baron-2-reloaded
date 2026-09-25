/**
 * Quick-dogfight fairness survey (AI_SOAK=fairness). Flies seeded quick dogfights between
 * pairs of fighters with the autoplayer and reports, per matchup, the player's fate and
 * the player side's share of all aircraft lost (0.5 = an even exchange).
 *
 *   AI_SOAK=fairness AI_FAIR_REPS=24 AI_FAIR_SET=default pnpm vitest run src/ai/fairness.soak.test.ts
 *
 * AI_FAIR_SET: `default` (the Quick Mission screen's setup), `mirror` (same type and skill
 * both sides: checks the AI itself is even), `matrix` (common 1917-18 matchups), `survey`
 * (the autoplay survey's quick setups). AI_FAIR_SKILL forces every pilot, player included,
 * to one skill.
 */
import { describe, it } from 'vitest';
import { buildQuickMission } from '../campaign';
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, SkillLevel } from '../core/types';
import { runAutoplay } from '../game/autoplay';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const REPS = Number(process.env.AI_FAIR_REPS ?? 16);
const SET = process.env.AI_FAIR_SET ?? 'default';
const FORCE = process.env.AI_FAIR_SKILL as SkillLevel | undefined;
/** Only setups whose label contains this substring. */
const ONLY = process.env.AI_FAIR_ONLY ?? '';

type Setup = QuickMissionOptions & { label: string };
const base = (player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): Setup => ({
  label: `${player} v ${enemy}`,
  type: 'dogfight',
  playerAircraft: player,
  enemyAircraft: enemy,
  enemyCount: 2,
  wingmen: 1,
  enemySkill: 'regular',
  wingmanSkill: 'regular',
  altitudeM: 2500,
  startPosition: 'head-on',
  timeOfDay: 'afternoon',
  cloudCover: 0.35,
  ...extra,
});

const SETS: Record<string, Setup[]> = {
  default: [base('sopwith_camel', 'albatros_dv')],
  mirror: [base('sopwith_camel', 'sopwith_camel'), base('albatros_dv', 'albatros_dv'), base('fokker_dri', 'fokker_dri'), base('spad_xiii', 'spad_xiii'), base('fokker_dvii', 'fokker_dvii')],
  matrix: [
    base('sopwith_camel', 'albatros_dv'),
    base('albatros_dv', 'sopwith_camel'),
    base('sopwith_camel', 'fokker_dri'),
    base('fokker_dri', 'sopwith_camel'),
    base('se5a', 'albatros_dv'),
    base('albatros_dv', 'se5a'),
    base('spad_xiii', 'fokker_dvii'),
    base('fokker_dvii', 'spad_xiii'),
  ],
  survey: [
    { ...base('sopwith_camel', 'fokker_dri', { enemyCount: 3, wingmen: 2, altitudeM: 2000, startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3 }), label: 'camel v 3 dr1 (survey)' },
    { ...base('fokker_dvii', 'spad_xiii', { enemySkill: 'veteran', startPosition: 'head-on', cloudCover: 0.5 }), label: 'dvii v 2 vet spad (survey)' },
  ],
};

describe.skipIf(!SOAK.includes('fairness'))('quick dogfight fairness', () => {
  it('reports player fate and exchange per matchup', () => {
    const setups = SET.split(',').flatMap((s) => SETS[s] ?? []).filter((s) => s.label.includes(ONLY));
    const lines: string[] = [`fairness set=${SET} reps=${REPS}${FORCE ? ` skill=${FORCE}` : ''}`];
    lines.push('setup | n | win% | player down% (killed/captured/wounded) | player-side share of losses | wingmen / enemies lost | kills/mission | player loss causes | structural failures (all aircraft)');
    for (const s of setups) {
      let win = 0;
      let down = 0;
      let killed = 0;
      let captured = 0;
      let wounded = 0;
      let ours = 0;
      let wingLost = 0;
      let theirs = 0;
      let kills = 0;
      const causes = new Map<string, number>();
      const ev = { structural: 0, stalls: 0 };
      for (let r = 0; r < REPS; r++) {
        const m = buildQuickMission(s, 5000 + r * 131);
        if (FORCE) for (const f of m.flights) for (const mem of f.members) mem.skill = FORCE;
        const rep = runAutoplay(m, { maxTime: 1500 });
        const fate = rep.result.playerFate;
        const playerDown = fate === 'killed' || fate === 'captured' || fate === 'wounded' ? 1 : 0;
        if (rep.result.missionSuccess) win++;
        down += playerDown;
        if (fate === 'killed') killed++;
        if (fate === 'captured') captured++;
        if (fate === 'wounded') wounded++;
        // friendlyLosses lists the player's flight-mates; add the player when they went down.
        ours += rep.friendlyLosses + (rep.result.playerOutcome !== 'in-flight' && rep.result.playerOutcome !== 'landed-friendly' && rep.result.playerOutcome !== 'disengaged' ? 1 : 0);
        theirs += rep.enemyLosses;
        wingLost += rep.friendlyLosses;
        kills += rep.playerKills;
        const c = rep.playerLossCause?.replace(/\(.*\)$/, '') ?? null;
        if (c) causes.set(c, (causes.get(c) ?? 0) + 1);
        ev.structural += rep.events['structural-failure'] ?? 0;
      }
      const pct = (x: number) => `${Math.round((100 * x) / REPS)}%`;
      lines.push(
        [
          s.label.padEnd(30),
          REPS,
          pct(win),
          `${pct(down)} (${killed}/${captured}/${wounded})`,
          ours + theirs ? (ours / (ours + theirs)).toFixed(2) : '-',
          `wingmen lost ${wingLost} enemy lost ${theirs}`,
          (kills / REPS).toFixed(2),
          `causes ${[...causes].map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
          `structural ${ev.structural}`,
        ].join(' | '),
      );
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
