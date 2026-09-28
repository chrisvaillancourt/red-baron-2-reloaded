import type { QuickMissionOptions } from '../core/campaignTypes';

/**
 * The Quick Mission screen's first-visit setup (src/ui/screens/quick.ts). The soaks import it,
 * so they measure the fight a new player actually meets.
 *
 * You and a wingman against a veteran pair of Fokker D.VIIs (DECISIONS D-078, superseding
 * D-076). The veteran autoplayer goes down in about 28% of these dogfights; against regular
 * D.VIIs, 7%. The same defaults apply to every mission type, so every type is harder than it
 * was against regular D.Vs, balloon attacks most of all (docs/ai.md "Wave 9").
 */
export const QUICK_DEFAULTS: Readonly<QuickMissionOptions> = Object.freeze({
  playerAircraft: 'sopwith_camel',
  enemyAircraft: 'fokker_dvii',
  enemyCount: 2,
  wingmen: 1,
  enemySkill: 'veteran',
  wingmanSkill: 'regular',
  altitudeM: 2500,
  startPosition: 'head-on',
  timeOfDay: 'afternoon',
  cloudCover: 0.35,
  type: 'dogfight',
});
