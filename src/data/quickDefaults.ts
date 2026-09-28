import type { QuickMissionOptions } from '../core/campaignTypes';

/**
 * The Quick Mission screen's first-visit setup (src/ui/screens/quick.ts). The soaks import it,
 * so they measure the fight a new player actually meets.
 *
 * You and a wingman against a pair of regular Albatros D.Vs (DECISIONS D-071, D-076).
 */
export const QUICK_DEFAULTS: Readonly<QuickMissionOptions> = Object.freeze({
  playerAircraft: 'sopwith_camel',
  enemyAircraft: 'albatros_dv',
  enemyCount: 2,
  wingmen: 1,
  enemySkill: 'regular',
  wingmanSkill: 'regular',
  altitudeM: 2500,
  startPosition: 'head-on',
  timeOfDay: 'afternoon',
  cloudCover: 0.35,
  type: 'dogfight',
});
