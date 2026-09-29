/**
 * Quick Mission crew options (docs/bombers.md): the player's seat, and the "Bombing raid"
 * type, wired but hidden until track D's raid builder exists. Pure; tested in Node.
 */
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { CrewStationId, MissionDefinition } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { crewStations } from '../data/crew';

/** Only a dev server with `?bombing` in the URL offers raids (with the bomb-carrying AI-only types). */
export function bombingRaidsOffered(dev: boolean, search: string): boolean {
  return dev && new URLSearchParams(search).has('bombing');
}

/** Saved options cleaned of a seat the aircraft lacks, and of a raid while raids are hidden. */
export function sanitizeQuickOptions(o: QuickMissionOptions, bombing: boolean): QuickMissionOptions {
  const out = { ...o };
  if (!bombing && out.type === 'bombing') out.type = 'dogfight';
  const spec = AIRCRAFT[out.playerAircraft];
  if (out.playerStation && (!spec || !crewStations(spec).some((s) => s.id === out.playerStation))) delete out.playerStation;
  return out;
}

/**
 * Put the player at the chosen station. TODO(bombers track D): the quick builder copies
 * `playerStation` into the player's flight member itself; then drop this.
 */
export function applyPlayerStation(m: MissionDefinition, station: CrewStationId | undefined): MissionDefinition {
  if (!station || station === 'pilot') return m;
  for (const f of m.flights) for (const mem of f.members) if (mem.isPlayer && !mem.station) mem.station = station;
  return m;
}

/**
 * Dev stand-in for the "Bombing raid" builder: a quick ground attack turned into a bomb run
 * (the flight's task 'bomb', its attack waypoints 'bomb' waypoints). TODO(bombers track D):
 * `buildQuickMission` handles 'bombing'; then drop this.
 */
export function devBombingRaid(build: (o: QuickMissionOptions) => MissionDefinition, o: QuickMissionOptions): MissionDefinition {
  const m = build({ ...o, type: 'ground-attack' });
  m.type = 'bombing';
  for (const f of m.flights) {
    if (!f.members.some((x) => x.isPlayer)) continue;
    f.task = 'bomb';
    for (const wp of f.waypoints) if (wp.action === 'attack-ground') wp.action = 'bomb';
  }
  return m;
}
