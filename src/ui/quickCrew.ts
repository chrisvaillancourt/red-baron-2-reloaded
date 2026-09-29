/**
 * Quick Mission crew options (docs/bombers.md): the player's seat, and which aircraft each
 * mission type offers. The builder (`buildQuickMission`) puts the player at `playerStation`
 * and builds the "Bombing raid" itself. Pure; tested in Node.
 */
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftSpec } from '../core/types';
import { AIRCRAFT, AIRCRAFT_LIST } from '../data/aircraft';
import { crewStations } from '../data/crew';
import { QUICK_DEFAULTS } from '../data/quickDefaults';

const sideOf = (s: AircraftSpec) => (s.nation === 'germany' ? 'central' : 'allied');

/** The player's aircraft for a mission type: a raid needs a type that carries bombs, anything else a flyable type. */
export function quickPlayerAircraft(type: QuickMissionOptions['type']): AircraftSpec[] {
  return AIRCRAFT_LIST.filter((s) => (type === 'bombing' ? !!s.bombs?.length : s.flyable));
}

/**
 * Options made consistent: an aircraft the mission type offers (a raid switches to a bomber,
 * of the player's side if there is one; leaving a raid in an AI-only bomber goes back to the
 * default fighter), and no seat the aircraft lacks.
 */
export function sanitizeQuickOptions(o: QuickMissionOptions): QuickMissionOptions {
  const out = { ...o };
  const offered = quickPlayerAircraft(out.type);
  const cur = AIRCRAFT[out.playerAircraft];
  if (!cur || !offered.some((s) => s.id === cur.id)) {
    const side = cur ? sideOf(cur) : undefined;
    const pick = out.type === 'bombing' ? (offered.find((s) => sideOf(s) === side) ?? offered[0]) : AIRCRAFT[QUICK_DEFAULTS.playerAircraft];
    if (pick) out.playerAircraft = pick.id;
  }
  const spec = AIRCRAFT[out.playerAircraft];
  if (out.playerStation && (!spec || !crewStations(spec).some((s) => s.id === out.playerStation))) delete out.playerStation;
  return out;
}
