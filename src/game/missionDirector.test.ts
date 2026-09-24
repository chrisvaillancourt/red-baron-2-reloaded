import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { MissionDefinition } from '../core/types';
import { getAerodrome } from '../data/aerodromes';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import { clockPosition, MissionDirector } from './missionDirector';
import { stubBuildQuickMission } from './stubs/campaign';
import { stubCreateFlightEnvironment, stubSim } from './stubs/sim';
import { buildWorld } from './world';

function setup(mutate?: (m: MissionDefinition) => void) {
  const mission = stubBuildQuickMission({
    playerAircraft: 'sopwith_camel',
    enemyAircraft: 'albatros_dv',
    enemyCount: 2,
    wingmen: 1,
    enemySkill: 'regular',
    wingmanSkill: 'regular',
    altitudeM: 1500,
    startPosition: 'head-on',
    timeOfDay: 'morning',
    cloudCover: 0,
    type: 'dogfight',
  });
  mission.balloons.push({ id: 'b1', side: 'central', x: 6000, z: 0, altitude: 800 });
  mission.groundTargets.push({ id: 'g1', type: 'truck', side: 'central', x: 5000, z: 500, heading: 0 });
  mutate?.(mission);
  const env = stubCreateFlightEnvironment(terrainHeightAt, mission.weather);
  const world = buildWorld({ mission, modules: { sim: stubSim, sideOfFrontAt }, env, realism: DEFAULT_SETTINGS.realism });
  const bus = createEventBus();
  const radio: string[] = [];
  const director = new MissionDirector(world, bus, (_f, t) => radio.push(t), { crashEndDelay: 1, landedEndDelay: 0.5 });
  const player = world.player!;
  const wingman = world.flightMembers.get('player')![1];
  const enemies = world.flightMembers.get('enemy')!;
  return { mission, world, bus, director, player, wingman, enemies, radio };
}

function kill(bus: ReturnType<typeof createEventBus>, victimId: number, killerId: number, pos: Vector3, world: ReturnType<typeof setup>['world']) {
  const v = world.getEntity(victimId);
  if (v?.kind === 'aircraft') v.outcome = 'shot-down';
  bus.emit({ type: 'aircraft-destroyed', victimId, killerId, outcome: 'shot-down', position: pos });
}

describe('MissionDirector', () => {
  it('credits the player with a witnessed claim when a wingman is near', () => {
    const t = setup();
    const e = t.enemies[0];
    t.wingman.state.position.copy(e.state.position).add(new Vector3(500, 0, 0));
    kill(t.bus, e.id, t.player.id, e.state.position.clone(), t.world);
    expect(t.director.claims).toHaveLength(1);
    expect(t.director.claims[0]).toMatchObject({ victimAircraftId: 'albatros_dv', witnessed: true, shared: false, victimSide: 'central' });
  });

  it('marks unwitnessed claims deep over enemy lines and shared kills', () => {
    const t = setup();
    const e = t.enemies[0];
    const pos = new Vector3(20000, 1500, 0); // well east of the line
    e.state.position.copy(pos);
    t.wingman.state.position.set(-20000, 1500, 0);
    t.bus.emit({ type: 'bullet-hit', targetId: e.id, shooterId: t.wingman.id, position: pos, zone: 'engine' });
    kill(t.bus, e.id, t.player.id, pos, t.world);
    expect(t.director.claims[0]).toMatchObject({ witnessed: false, shared: true });
  });

  it('completes destroy-aircraft objectives and reports success', () => {
    const t = setup();
    for (const e of t.enemies) kill(t.bus, e.id, t.player.id, e.state.position.clone(), t.world);
    t.director.update(0.01);
    expect(t.director.completedObjectives.has('kill')).toBe(true);
    t.director.requestEndFlight();
    const r = t.director.buildResult();
    expect(r.missionSuccess).toBe(true);
    expect(r.enemyLosses).toBe(2);
    expect(r.claims).toHaveLength(2);
    expect(r.objectives.find((o) => o.id === 'live')!.completed).toBe(true);
  });

  it('records wingman victories separately', () => {
    const t = setup();
    kill(t.bus, t.enemies[0].id, t.wingman.id, t.enemies[0].state.position.clone(), t.world);
    const r = t.director.buildResult();
    expect(r.claims).toHaveLength(0);
    expect(r.wingmanClaims).toEqual([{ pilotName: t.wingman.callsign, count: 1 }]);
  });

  it('refuses end-flight with enemies near or over enemy lines', () => {
    const t = setup();
    t.enemies[0].state.position.copy(t.player.state.position).add(new Vector3(1000, 0, 0));
    expect(t.director.canEndFlight().ok).toBe(false);
    for (const e of t.enemies) e.outcome = 'shot-down';
    t.player.state.position.set(15000, 1500, 0);
    expect(t.director.canEndFlight()).toMatchObject({ ok: false });
    t.player.state.position.set(-15000, 1500, 0);
    expect(t.director.requestEndFlight()).toBe(true);
    expect(t.director.ended).toBe(true);
    expect(t.director.buildResult()).toMatchObject({ endedByPlayer: true, playerFate: 'returned', playerOutcome: 'in-flight' });
  });

  it('maps player fates', () => {
    let t = setup();
    t.player.damage.pilotKilled = true;
    t.player.outcome = 'pilot-killed';
    expect(t.director.playerFate()).toBe('killed');

    t = setup();
    t.player.outcome = 'landed-enemy';
    expect(t.director.playerFate()).toBe('captured');

    t = setup();
    const home = getAerodrome(t.mission.homeAerodromeId)!;
    t.player.state.position.set(home.x + 200, 100, home.z);
    t.player.outcome = 'landed-friendly';
    expect(t.director.playerFate()).toBe('returned');
    t.player.state.position.set(home.x + 10000, 100, home.z);
    expect(t.director.playerFate()).toBe('landed-elsewhere');
    t.player.damage.pilotWounded = true;
    expect(t.director.playerFate()).toBe('wounded');

    t = setup();
    t.player.state.velocity.set(20, -5, 0);
    t.director.update(0.01); // records impact speed
    t.player.state.position.set(-15000, 50, 0);
    t.player.outcome = 'crashed';
    expect(t.director.playerFate()).toBe('wounded');
    t.player.state.position.set(15000, 50, 0);
    expect(t.director.playerFate()).toBe('captured');
    t.player.damage.onFire = true;
    expect(t.director.playerFate()).toBe('killed');
  });

  it('ends the mission after the player crashes, emitting a destroyed event once', () => {
    const t = setup();
    let destroyed = 0;
    t.bus.on('aircraft-destroyed', () => destroyed++);
    t.player.outcome = 'crashed';
    t.director.update(0.5);
    expect(t.director.ended).toBe(false);
    t.director.update(0.6);
    expect(t.director.ended).toBe(true);
    expect(destroyed).toBe(1);
  });

  it('tracks balloon claims and ground/balloon objectives', () => {
    const t = setup((m) => {
      m.objectives.push({ id: 'bal', kind: 'destroy-balloons', description: 'Burn it', targetIds: ['b1'], count: 1, primary: false });
      m.objectives.push({ id: 'gnd', kind: 'destroy-ground', description: 'Truck', targetIds: ['g1'], count: 1, primary: false });
    });
    const b = t.world.balloons[0];
    b.destroyed = true;
    t.bus.emit({ type: 'balloon-destroyed', balloonId: b.id, killerId: t.player.id, position: b.position.clone() });
    t.world.groundTargets[0].destroyed = true;
    t.director.update(0.01);
    expect(t.director.claims[0].victimAircraftId).toBe('balloon');
    expect(t.director.completedObjectives.has('bal')).toBe(true);
    expect(t.director.completedObjectives.has('gnd')).toBe(true);
  });

  it('protect-flight is judged only at the end', () => {
    const t = setup((m) => {
      m.objectives.push({ id: 'prot', kind: 'protect-flight', description: 'Keep wingman alive', targetIds: ['player'], count: 2, primary: true });
    });
    t.director.update(0.01);
    expect(t.director.completedObjectives.has('prot')).toBe(false);
    expect(t.director.buildResult().objectives.find((o) => o.id === 'prot')!.completed).toBe(true);
    t.wingman.outcome = 'shot-down';
    expect(t.director.buildResult().objectives.find((o) => o.id === 'prot')!.completed).toBe(false);
    expect(t.director.buildResult().friendlyLosses).toHaveLength(1);
  });

  it('calls out enemies by clock position', () => {
    const t = setup();
    t.enemies[0].state.position.copy(t.player.state.position).add(new Vector3(0, 600, -3000));
    t.director.update(0.01);
    expect(t.radio.some((m) => m.startsWith('Enemy aircraft!'))).toBe(true);
  });
});

describe('clockPosition', () => {
  it('reports 12 high / 3 level / 6 low relative to heading', () => {
    const t = setup();
    const p = t.player; // heading east (+X)
    const at = (dx: number, dy: number, dz: number) => clockPosition(p, p.state.position.clone().add(new Vector3(dx, dy, dz)));
    expect(at(1000, 500, 0)).toEqual({ clock: 12, elevation: 'high' });
    expect(at(0, 0, 1000)).toEqual({ clock: 3, elevation: 'level' });
    expect(at(-1000, -500, 0)).toEqual({ clock: 6, elevation: 'low' });
  });
});
