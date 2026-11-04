/**
 * Setup tables for the quick-mission surveys (fairness, tailhold, raid, gundiag soaks).
 * They live outside the *.test.ts files so surveySets.test.ts can check their names
 * against tools/dev/ab.mjs's hand-kept list (ab.mjs can't import this module: node's
 * type stripping can't resolve the extensionless imports below). Select from a table with
 * selectSets (src/game/testing/env.ts), which keeps CSV order and rejects unknown names.
 */
import type { QuickMissionOptions } from '../../core/campaignTypes';
import type { AircraftId } from '../../core/types';
import { QUICK_DEFAULTS } from '../../data/quickDefaults';

/** A quick-mission setup with the label a survey prints for it. */
export type SurveySetup = QuickMissionOptions & { label: string };

// ---- fairness (AI_FAIR_SET) ----
const fairBase = (player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): SurveySetup => ({
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

export const FAIRNESS_SETS: Record<string, SurveySetup[]> = {
  // The Quick Mission screen's setup (src/data/quickDefaults.ts). The pre-wave-9 D.V default is in `matrix` and `camel`.
  default: [{ ...QUICK_DEFAULTS, label: 'default (quick screen)' }],
  // The default fight with veteran enemies (the Quick Mission screen's harder setting).
  vet: [{ ...fairBase('sopwith_camel', 'albatros_dv', { enemySkill: 'veteran' }), label: 'camel v 2 vet d.v' }, { ...fairBase('sopwith_camel', 'fokker_dri', { enemySkill: 'veteran' }), label: 'camel v 2 vet dr.i' }],
  // Candidate even defaults once the D.V is ruled out (it can't turn with a Camel).
  even: [{ ...fairBase('sopwith_camel', 'fokker_dvii', { enemySkill: 'veteran' }), label: 'camel v 2 vet d.vii' }, { ...fairBase('sopwith_camel', 'fokker_dri', { enemySkill: 'novice' }), label: 'camel v 2 novice dr.i' }],
  // D.VII candidates for the Quick Mission default (wave 9): skill and numbers.
  dvii: [
    { ...fairBase('sopwith_camel', 'fokker_dvii'), label: 'camel+1 v 2 reg d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { enemySkill: 'veteran' }), label: 'camel+1 v 2 vet d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { enemyCount: 3 }), label: 'camel+1 v 3 reg d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { wingmen: 0 }), label: 'camel alone v 2 reg d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { wingmanSkill: 'novice' }), label: 'camel+novice v 2 reg d.vii' },
  ],
  // The same candidates as quick ground attacks (the screen's defaults apply to every type).
  dviiground: [
    { ...fairBase('sopwith_camel', 'albatros_dv', { type: 'ground-attack' }), label: 'ga camel+1 v 2 reg d.v' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type: 'ground-attack' }), label: 'ga camel+1 v 2 reg d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', enemySkill: 'veteran' }), label: 'ga camel+1 v 2 vet d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', wingmen: 0 }), label: 'ga camel alone v 2 reg d.vii' },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type: 'ground-attack', wingmanSkill: 'novice' }), label: 'ga camel+novice v 2 reg d.vii' },
  ],
  // Old default (2 regular D.V) against the new one (2 veteran D.VII) on the other quick types.
  dviitypes: (['balloon-attack', 'escort', 'intercept'] as const).flatMap((type) => [
    { ...fairBase('sopwith_camel', 'albatros_dv', { type }), label: `${type} old d.v` },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type, enemySkill: 'veteran' }), label: `${type} vet d.vii` },
    { ...fairBase('sopwith_camel', 'fokker_dvii', { type }), label: `${type} reg d.vii` },
  ]),
  // Two-seaters, so an A/B of gunner or crew-station changes measures a rear gunner (FRICTION F-32).
  twoseat: [fairBase('bristol_f2b', 'albatros_dv'), fairBase('fokker_dvii', 're8')],
  mirror: [fairBase('sopwith_camel', 'sopwith_camel'), fairBase('albatros_dv', 'albatros_dv'), fairBase('fokker_dri', 'fokker_dri'), fairBase('spad_xiii', 'spad_xiii'), fairBase('fokker_dvii', 'fokker_dvii')],
  matrix: [
    fairBase('sopwith_camel', 'albatros_dv'),
    fairBase('albatros_dv', 'sopwith_camel'),
    fairBase('sopwith_camel', 'fokker_dri'),
    fairBase('fokker_dri', 'sopwith_camel'),
    fairBase('se5a', 'albatros_dv'),
    fairBase('albatros_dv', 'se5a'),
    fairBase('spad_xiii', 'fokker_dvii'),
    fairBase('fokker_dvii', 'spad_xiii'),
  ],
  // Candidate even first fights for the Quick Mission default (src/ui/screens/quick.ts).
  camel: [fairBase('sopwith_camel', 'albatros_dv'), fairBase('sopwith_camel', 'pfalz_diiia'), fairBase('sopwith_camel', 'fokker_dri'), fairBase('sopwith_camel', 'fokker_dvii'), fairBase('se5a', 'albatros_dv'), fairBase('se5a', 'pfalz_diiia'), fairBase('spad_xiii', 'fokker_dvii')],
  // Energy types against turners, both ways round: where boom-and-zoom should pay.
  energy: [fairBase('sopwith_camel', 'fokker_dvii'), fairBase('fokker_dvii', 'sopwith_camel'), fairBase('fokker_dri', 'spad_xiii'), fairBase('spad_xiii', 'fokker_dri'), fairBase('fokker_dri', 'se5a'), fairBase('se5a', 'fokker_dri')],
  survey: [
    { ...fairBase('sopwith_camel', 'fokker_dri', { enemyCount: 3, wingmen: 2, altitudeM: 2000, startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3 }), label: 'camel v 3 dr1 (survey)' },
    { ...fairBase('fokker_dvii', 'spad_xiii', { enemySkill: 'veteran', startPosition: 'head-on', cloudCover: 0.5 }), label: 'dvii v 2 vet spad (survey)' },
  ],
};

// ---- tailhold (AI_TH_SET) ----
const tailBase = (player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): SurveySetup => ({
  label: `${player} v ${enemy}`,
  type: 'dogfight', playerAircraft: player, enemyAircraft: enemy, enemyCount: 2, wingmen: 1,
  enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35,
  ...extra,
});
export const TAILHOLD_SETS: Record<string, SurveySetup[]> = {
  default: [{ ...QUICK_DEFAULTS, label: 'default (quick screen)' }],
  mirror: [tailBase('sopwith_camel', 'sopwith_camel'), tailBase('fokker_dvii', 'fokker_dvii')],
  energy: [tailBase('sopwith_camel', 'fokker_dvii'), tailBase('fokker_dvii', 'sopwith_camel')],
  low: [
    {
      ...tailBase('bristol_f2b', 'fokker_dvii', { enemyCount: 5, wingmen: 3, enemySkill: 'ace', wingmanSkill: 'novice', altitudeM: 300, timeOfDay: 'dusk', cloudCover: 0.2 }),
      label: 'report: brisfit+3 v 5 ace d.vii 300 m',
    },
  ],
};

// ---- raid (AI_RAID_SET) ----
const raidSetup = (label: string, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): SurveySetup => ({
  label,
  type: 'bombing',
  playerAircraft: 'dh4',
  enemyAircraft: enemy,
  enemyCount: 3,
  wingmen: 2,
  enemySkill: 'regular',
  wingmanSkill: 'regular',
  altitudeM: 2500,
  startPosition: 'head-on',
  timeOfDay: 'afternoon',
  cloudCover: 0.35,
  ...extra,
});

export const RAID_SETS: Record<string, SurveySetup[]> = {
  default: [
    raidSetup('dh4+2 v 3 reg d.v', 'albatros_dv'),
    raidSetup('dh4+2 v 3 reg d.v, 2 camel escort', 'albatros_dv', { escortCount: 2, escortAircraft: 'sopwith_camel' }),
    raidSetup('dh4+2 v 2 vet d.vii, 2 se5a escort', 'fokker_dvii', { enemyCount: 2, enemySkill: 'veteran', escortCount: 2, escortAircraft: 'se5a' }),
  ],
  escort: [0, 1, 2, 4].map((n) => raidSetup(`dh4+2 v 3 reg d.v, ${n} se5a escort`, 'albatros_dv', { escortCount: n, escortAircraft: 'se5a' })),
};

// ---- gundiag (AI_GD_SET) ----
const gunBase = (player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): QuickMissionOptions => ({
  type: 'dogfight', playerAircraft: player, enemyAircraft: enemy, enemyCount: 2, wingmen: 1,
  enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35,
  ...extra,
});
export const GUNDIAG_SETS: Record<string, QuickMissionOptions[]> = {
  // The Quick Mission screen's setup (src/data/quickDefaults.ts); `dv` is the pre-wave-9 default.
  default: [{ ...QUICK_DEFAULTS }],
  dv: [gunBase('sopwith_camel', 'albatros_dv')],
  reverse: [gunBase('albatros_dv', 'sopwith_camel')],
  mirror: [gunBase('sopwith_camel', 'sopwith_camel'), gunBase('albatros_dv', 'albatros_dv')],
  // Entry geometry by enemy skill: aces should come from above / out of the sun far more than novices.
  skill: [gunBase('sopwith_camel', 'albatros_dv', { enemySkill: 'novice' }), gunBase('sopwith_camel', 'albatros_dv', { enemySkill: 'ace' }), gunBase('sopwith_camel', 'sopwith_camel', { enemySkill: 'novice' }), gunBase('sopwith_camel', 'sopwith_camel', { enemySkill: 'ace' })],
};
