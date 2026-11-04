import { describe, expect, it } from 'vitest';
import type { QuickMissionOptions } from '../core/campaignTypes';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { AircraftEntity } from '../core/types';
import { buildQuickMission } from '../campaign/quickMission';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { headlessModules } from './autoplay';
import { buildMapView, ENEMY_MAP_RANGE_M, MAP_SPAN_M } from './mapView';
import { SimCore } from './simCore';
import type { MapMarker, MapView } from '../ui/map/mapRenderer';

const realism = () => DEFAULT_SETTINGS.realism;

/** buildMapView, with its (always filled) markers list made non-optional. */
function view(args: Parameters<typeof buildMapView>[0]): MapView & { markers: MapMarker[] } {
  const v = buildMapView(args);
  expect(v.markers).toBeDefined();
  return { ...v, markers: v.markers ?? [] };
}

function setup(o: Partial<QuickMissionOptions> = {}, seed = 2024) {
  const mission = buildQuickMission({ ...QUICK_DEFAULTS, playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', wingmen: 2, enemyCount: 2, cloudCover: 0, ...o }, seed);
  const core = new SimCore(headlessModules, mission, realism);
  const world = core.world;
  const player = world.player!;
  const friends = world.aircraft.filter((a) => a !== player && a.side === player.side);
  const enemies = world.aircraft.filter((a) => a.side !== player.side);
  return { mission, world, player, friends, enemies };
}

const aircraftMarkers = (ms: readonly MapMarker[]) => ms.filter((m) => m.kind === 'aircraft');
const isAt = (a: AircraftEntity) => (m: MapMarker) => m.x === a.state.position.x && m.z === a.state.position.z;

/** Place `a` at `d` metres east of `p`, level. */
function placeFrom(p: AircraftEntity, a: AircraftEntity, d: number) {
  a.state.position.copy(p.state.position).setX(p.state.position.x + d);
}

describe('buildMapView', () => {
  it('shows the player, friendlies at any range and enemies only within range', () => {
    const t = setup();
    expect(t.friends.length).toBeGreaterThan(0);
    expect(t.enemies.length).toBeGreaterThanOrEqual(2);
    const [inside, outside] = t.enemies;
    placeFrom(t.player, t.friends[0], ENEMY_MAP_RANGE_M * 5);
    placeFrom(t.player, inside, ENEMY_MAP_RANGE_M - 1);
    placeFrom(t.player, outside, -(ENEMY_MAP_RANGE_M + 1));
    for (const e of t.enemies.slice(2)) placeFrom(t.player, e, ENEMY_MAP_RANGE_M * 3);
    const v = view({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 });
    const ac = aircraftMarkers(v.markers);
    const pm = ac.filter((m) => m.kind === 'aircraft' && m.isPlayer);
    expect(pm).toHaveLength(1);
    expect(pm[0]).toMatchObject({ x: t.player.state.position.x, z: t.player.state.position.z, side: t.player.side });
    expect(ac.some(isAt(t.friends[0]))).toBe(true);
    expect(ac.some(isAt(inside))).toBe(true);
    expect(ac.some(isAt(outside))).toBe(false);
    expect(ac).toHaveLength(1 + t.friends.length + 1);
    expect(v.center).toEqual({ x: t.player.state.position.x, z: t.player.state.position.z });
    expect(v.playerSide).toBe(t.player.side);
    expect(v.spanM).toBe(MAP_SPAN_M);
  });

  it('drops aircraft that are out of play', () => {
    const t = setup();
    const gone = t.friends[0];
    gone.outcome = 'crashed';
    const v = view({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 });
    expect(aircraftMarkers(v.markers).some(isAt(gone))).toBe(false);
  });

  // Current behaviour, pinned by the extraction: with no player nothing counts as friendly or
  // near, so no aircraft show at all. (Not necessarily intended; a change belongs in its own fix.)
  it('with no player shows no aircraft and no centre', () => {
    const t = setup();
    t.world.player = null;
    const v = view({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 });
    expect(t.world.aircraft.some((a) => a.outcome === null)).toBe(true);
    expect(aircraftMarkers(v.markers)).toHaveLength(0);
    expect(v.markers.some((m) => m.kind === 'aircraft' && m.isPlayer)).toBe(false);
    expect(v.center).toBeUndefined();
    expect(v.playerSide).toBeUndefined();
    expect(v.route).toBeUndefined();
  });

  it('lists ground targets once each, de-hyphenated, after the aircraft', () => {
    const t = setup({ type: 'ground-attack' });
    expect(t.world.groundTargets.length).toBeGreaterThan(0);
    t.world.groundTargets[0].type = 'tent-hangar';
    t.world.groundTargets[0].destroyed = true;
    const v = view({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 });
    const ground = v.markers.filter((m) => m.kind === 'ground');
    expect(ground).toHaveLength(t.world.groundTargets.length);
    t.world.groundTargets.forEach((g, i) => {
      expect(ground[i]).toMatchObject({ x: g.position.x, z: g.position.z, side: g.side, destroyed: g.destroyed, label: g.type.replace(/-/g, ' ') });
    });
    expect(ground[0]).toMatchObject({ label: 'tent hangar', destroyed: true });
    const kinds = v.markers.map((m) => m.kind);
    expect(kinds.lastIndexOf('aircraft')).toBeLessThan(kinds.indexOf('ground'));
  });

  it('lists balloons once each, between aircraft and ground targets', () => {
    const t = setup({ type: 'balloon-attack' });
    expect(t.world.balloons.length).toBeGreaterThan(0);
    t.world.balloons[0].destroyed = true;
    const v = view({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 });
    const balloons = v.markers.filter((m) => m.kind === 'balloon');
    expect(balloons).toHaveLength(t.world.balloons.length);
    t.world.balloons.forEach((b, i) => expect(balloons[i]).toMatchObject({ x: b.position.x, z: b.position.z, side: b.side, destroyed: b.destroyed }));
    const kinds = v.markers.map((m) => m.kind);
    expect(kinds.lastIndexOf('aircraft')).toBeLessThan(kinds.indexOf('balloon'));
    if (kinds.includes('ground')) expect(kinds.lastIndexOf('balloon')).toBeLessThan(kinds.indexOf('ground'));
  });

  it('passes route, waypoint, mission fields and resolved units through', () => {
    const t = setup();
    const flight = t.world.getFlight(t.player.flightId)!;
    const v = view({ world: t.world, mission: t.mission, units: 'metric', waypointIndex: 2 });
    expect(v.route).toBe(flight.waypoints);
    expect(v.activeWaypoint).toBe(2);
    expect(v.units).toBe('metric');
    expect(v).toMatchObject({ date: t.mission.date, homeAerodromeId: t.mission.homeAerodromeId, title: t.mission.title, style: 'overlay' });
    expect(buildMapView({ world: t.world, mission: t.mission, units: 'imperial', waypointIndex: 0 }).units).toBe('imperial');
    // 'auto' follows the player's nation: a British Camel flies imperial.
    expect(buildMapView({ world: t.world, mission: t.mission, units: 'auto', waypointIndex: 0 }).units).toBe('imperial');
  });
});
