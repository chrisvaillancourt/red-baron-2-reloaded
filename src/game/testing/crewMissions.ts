/**
 * Hand-built missions for the crew seats and the bombsight (docs/bombers.md), until track D's
 * "Bombing raid" builder exists. Built from the quick-mission builder, then adjusted.
 */
import type { QuickMissionOptions } from '../../core/campaignTypes';
import type { CrewStationId, MissionDefinition } from '../../core/types';
import { buildQuickMission } from '../../campaign/quickMission';
import { QUICK_DEFAULTS } from '../../data/quickDefaults';

export function playerMember(m: MissionDefinition) {
  for (const f of m.flights) for (const mem of f.members) if (mem.isPlayer) return { flight: f, member: mem };
  throw new Error('mission has no player');
}

/** The player in a Bristol F.2b against Albatros scouts, starting at `station`. */
export function bristolFight(station?: CrewStationId, o: Partial<QuickMissionOptions> = {}, seed = 1234): MissionDefinition {
  const m = buildQuickMission({ ...QUICK_DEFAULTS, playerAircraft: 'bristol_f2b', enemyAircraft: 'albatros_dv', enemySkill: 'regular', wingmen: 0, cloudCover: 0, ...o }, seed);
  if (station) playerMember(m).member.station = station;
  return m;
}

/**
 * The player in a D.H.4 with its bomb load, on a bomb run over the ground targets of a quick
 * ground attack: the flight's task becomes 'bomb' and its attack waypoint a 'bomb' waypoint.
 */
export function dh4BombRun(station?: CrewStationId, seed = 4321): MissionDefinition {
  const m = buildQuickMission({ ...QUICK_DEFAULTS, playerAircraft: 'dh4', enemyAircraft: 'albatros_dv', enemySkill: 'regular', type: 'ground-attack', wingmen: 0, enemyCount: 1, cloudCover: 0, altitudeM: 2000 }, seed);
  m.type = 'bombing';
  const { flight, member } = playerMember(m);
  flight.task = 'bomb';
  for (const wp of flight.waypoints) if (wp.action === 'attack-ground') wp.action = 'bomb';
  if (station) member.station = station;
  return m;
}
