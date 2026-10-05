import type { QuickMissionOptions } from '../../core/campaignTypes';
import { buildQuickMission } from '../../campaign';
import { runAutoplay } from '../../game/autoplay';

const CAMEL_V_DR1: Omit<QuickMissionOptions, 'type'> = {
  playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dri', enemyCount: 3, wingmen: 2,
  enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2000,
  startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3,
};

/**
 * Actual Q-05 quick-survey cases, not the generic mixed-aircraft furball.
 * Survey seeds are 1000 + repetition * 97 + setup index (before filtering).
 * Keep the whole runtime approach: restoring only the two aircraft's public flight
 * states with fresh controllers did not reproduce the collisions.
 */
export const QUICK_COLLISION_CASES = [
  {
    name: 'AI opponents extending after a turning pass',
    // Camel dogfight #18: seed 2747, aircraft 2/5, extend/extend at ~220 s.
    options: { ...CAMEL_V_DR1, type: 'dogfight' } satisfies QuickMissionOptions,
    seed: 2747,
    maxTime: 225,
  },
  {
    name: 'an AI opponent extending past the player aircraft',
    // Camel intercept #5: seed 1495, aircraft 1/5, extend/extend at ~654 s.
    options: { ...CAMEL_V_DR1, type: 'intercept' } satisfies QuickMissionOptions,
    seed: 1495,
    maxTime: 660,
  },
  {
    name: 'an AI opponent converging with the defending player aircraft',
    // D.VII dogfight #3: seed 1293, aircraft 1/3, defend/extend at ~208 s.
    options: {
      type: 'dogfight', playerAircraft: 'fokker_dvii', enemyAircraft: 'spad_xiii',
      enemyCount: 2, wingmen: 1, enemySkill: 'veteran', wingmanSkill: 'regular',
      altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.5,
    } satisfies QuickMissionOptions,
    seed: 1293,
    maxTime: 215,
  },
];

export function runQuickCollisionCase(scenario: typeof QUICK_COLLISION_CASES[number]) {
  return runAutoplay(buildQuickMission(scenario.options, scenario.seed), {
    maxTime: scenario.maxTime,
    // Pin the survey's autoplayer, independent of a developer's soak environment.
    pilot: 'ai',
  });
}
