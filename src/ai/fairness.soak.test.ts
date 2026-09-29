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
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, SkillLevel } from '../core/types';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { runAutoplay, type AutoplayReport } from '../game/autoplay';
import { FAIRNESS_HEADER, fairnessLine } from '../game/autoplaySummary';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
// AI_TACTICS=boomZoomOutTurned=1,stalk=0,... flips src/ai/tactics.ts TACTICS_FLAGS for A/B runs.
applyTacticsFlagsFromEnv(process.env);
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
  // The Quick Mission screen's setup (src/data/quickDefaults.ts). The pre-wave-9 D.V default is in `matrix` and `camel`.
  default: [{ ...QUICK_DEFAULTS, label: 'default (quick screen)' }],
  // The default fight with veteran enemies (the Quick Mission screen's harder setting).
  vet: [{ ...base('sopwith_camel', 'albatros_dv', { enemySkill: 'veteran' }), label: 'camel v 2 vet d.v' }, { ...base('sopwith_camel', 'fokker_dri', { enemySkill: 'veteran' }), label: 'camel v 2 vet dr.i' }],
  // Candidate even defaults once the D.V is ruled out (it can't turn with a Camel).
  even: [{ ...base('sopwith_camel', 'fokker_dvii', { enemySkill: 'veteran' }), label: 'camel v 2 vet d.vii' }, { ...base('sopwith_camel', 'fokker_dri', { enemySkill: 'novice' }), label: 'camel v 2 novice dr.i' }],
  // D.VII candidates for the Quick Mission default (wave 9): skill and numbers.
  dvii: [
    { ...base('sopwith_camel', 'fokker_dvii'), label: 'camel+1 v 2 reg d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { enemySkill: 'veteran' }), label: 'camel+1 v 2 vet d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { enemyCount: 3 }), label: 'camel+1 v 3 reg d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { wingmen: 0 }), label: 'camel alone v 2 reg d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { wingmanSkill: 'novice' }), label: 'camel+novice v 2 reg d.vii' },
  ],
  // The same candidates as quick ground attacks (the screen's defaults apply to every type).
  dviiground: [
    { ...base('sopwith_camel', 'albatros_dv', { type: 'ground-attack' }), label: 'ga camel+1 v 2 reg d.v' },
    { ...base('sopwith_camel', 'fokker_dvii', { type: 'ground-attack' }), label: 'ga camel+1 v 2 reg d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', enemySkill: 'veteran' }), label: 'ga camel+1 v 2 vet d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', wingmen: 0 }), label: 'ga camel alone v 2 reg d.vii' },
    { ...base('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', wingmanSkill: 'novice' }), label: 'ga camel+novice v 2 reg d.vii' },
  ],
  // Old default (2 regular D.V) against the new one (2 veteran D.VII) on the other quick types.
  dviitypes: (['balloon-attack', 'escort', 'intercept'] as const).flatMap((type) => [
    { ...base('sopwith_camel', 'albatros_dv', { type }), label: `${type} old d.v` },
    { ...base('sopwith_camel', 'fokker_dvii', { type, enemySkill: 'veteran' }), label: `${type} vet d.vii` },
    { ...base('sopwith_camel', 'fokker_dvii', { type }), label: `${type} reg d.vii` },
  ]),
  // Two-seaters, so an A/B of gunner or crew-station changes measures a rear gunner (FRICTION F-32).
  twoseat: [base('bristol_f2b', 'albatros_dv'), base('fokker_dvii', 're8')],
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
  // Candidate even first fights for the Quick Mission default (src/ui/screens/quick.ts).
  camel: [base('sopwith_camel', 'albatros_dv'), base('sopwith_camel', 'pfalz_diiia'), base('sopwith_camel', 'fokker_dri'), base('sopwith_camel', 'fokker_dvii'), base('se5a', 'albatros_dv'), base('se5a', 'pfalz_diiia'), base('spad_xiii', 'fokker_dvii')],
  // Energy types against turners, both ways round: where boom-and-zoom should pay.
  energy: [base('sopwith_camel', 'fokker_dvii'), base('fokker_dvii', 'sopwith_camel'), base('fokker_dri', 'spad_xiii'), base('spad_xiii', 'fokker_dri'), base('fokker_dri', 'se5a'), base('se5a', 'fokker_dri')],
  survey: [
    { ...base('sopwith_camel', 'fokker_dri', { enemyCount: 3, wingmen: 2, altitudeM: 2000, startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3 }), label: 'camel v 3 dr1 (survey)' },
    { ...base('fokker_dvii', 'spad_xiii', { enemySkill: 'veteran', startPosition: 'head-on', cloudCover: 0.5 }), label: 'dvii v 2 vet spad (survey)' },
  ],
};

describe.skipIf(!SOAK.includes('fairness'))('quick dogfight fairness', () => {
  it('reports player fate and exchange per matchup', () => {
    const setups = SET.split(',').flatMap((s) => SETS[s] ?? []).filter((s) => s.label.includes(ONLY));
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
