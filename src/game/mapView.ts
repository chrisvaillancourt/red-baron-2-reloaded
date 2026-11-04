/**
 * In-flight map view: turns the live session world into the `MapView` the HUD
 * map draws. Pure: reads the world, mission and settings, mutates nothing.
 *
 * Fog of war: friendlies always show, enemy aircraft only within
 * ENEMY_MAP_RANGE_M of the player, destroyed aircraft never; with no player,
 * every live aircraft shows.
 */
import { Vector3 } from 'three';
import type { GameSettings, MissionDefinition } from '../core/types';
import type { MapMarker, MapView } from '../ui/map/mapRenderer';
import { resolveUnits } from '../ui/format';
import type { SessionWorld } from './world';

/** Enemy aircraft farther than this from the player are hidden from the map. */
export const ENEMY_MAP_RANGE_M = 6000;
/** Side of the square the in-flight map spans, centred on the player. */
export const MAP_SPAN_M = 40_000;

export interface MapViewArgs {
  world: SessionWorld;
  mission: MissionDefinition;
  units: GameSettings['units'];
  waypointIndex: number;
}

export function buildMapView({ world, mission, units: unitsPref, waypointIndex }: MapViewArgs): MapView {
  const p = world.player;
  const units = resolveUnits(unitsPref, p?.nation ?? 'britain').system;
  const markers: MapMarker[] = [];
  for (const a of world.aircraft) {
    if (a.outcome !== null) continue;
    const friendly = p && a.side === p.side;
    const near = p && a.state.position.distanceTo(p.state.position) < ENEMY_MAP_RANGE_M;
    if (a !== p && !friendly && !near) continue;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation);
    markers.push({ kind: 'aircraft', x: a.state.position.x, z: a.state.position.z, side: a.side, heading: Math.atan2(fwd.x, -fwd.z), isPlayer: a === p });
  }
  for (const b of world.balloons) markers.push({ kind: 'balloon', x: b.position.x, z: b.position.z, side: b.side, destroyed: b.destroyed });
  for (const g of world.groundTargets)
    markers.push({ kind: 'ground', x: g.position.x, z: g.position.z, side: g.side, destroyed: g.destroyed, label: g.type.replace(/-/g, ' ') });
  const flight = p ? world.getFlight(p.flightId) : undefined;
  return {
    date: mission.date,
    units,
    playerSide: p?.side,
    center: p ? { x: p.state.position.x, z: p.state.position.z } : undefined,
    spanM: MAP_SPAN_M,
    route: flight?.waypoints,
    activeWaypoint: waypointIndex,
    markers,
    homeAerodromeId: mission.homeAerodromeId,
    title: mission.title,
    style: 'overlay',
  };
}
