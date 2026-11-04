import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { MissionDefinition } from '../core/types';
import { sideOfFrontAt } from '../world/frontline';
import { stubBuildQuickMission } from './stubs/campaign';
import { stubCreateFlightEnvironment, stubSim } from './stubs/sim';
import { buildWorld, formationOffset } from './world';

/** Player flight 'player' (player + `wingmen`), enemy flight 'enemy' (`enemyCount`), flat ground. */
function setup(opts: { wingmen?: number; enemyCount?: number } = {}, mutate?: (m: MissionDefinition) => void) {
  const mission = stubBuildQuickMission({
    playerAircraft: 'sopwith_camel',
    enemyAircraft: 'albatros_dv',
    enemyCount: opts.enemyCount ?? 2,
    wingmen: opts.wingmen ?? 1,
    enemySkill: 'regular',
    wingmanSkill: 'regular',
    altitudeM: 1500,
    startPosition: 'head-on',
    timeOfDay: 'morning',
    cloudCover: 0,
    type: 'dogfight',
  });
  mutate?.(mission);
  const env = stubCreateFlightEnvironment(() => 0, mission.weather);
  const world = buildWorld({ mission, modules: { sim: stubSim, sideOfFrontAt }, env, realism: DEFAULT_SETTINGS.realism });
  return { mission, world };
}

function flight(m: MissionDefinition, id: string) {
  const f = m.flights.find((x) => x.id === id);
  if (!f) throw new Error(`no flight ${id}`);
  return f;
}

const ids = (list: { id: number }[]) => list.map((a) => a.id);

describe('buildWorld: pending vs live', () => {
  it('holds a delayed enemy flight back and spawns undelayed flights live', () => {
    const { world } = setup({}, (m) => {
      flight(m, 'enemy').spawnDelay = 30;
    });
    const enemies = world.flightMembers.get('enemy')!;
    const players = world.flightMembers.get('player')!;
    expect(ids(world.pending.map((p) => p.ac))).toEqual(ids(enemies));
    expect(world.pending.every((p) => p.spawnAt === 30)).toBe(true);
    expect(ids(world.aircraft)).toEqual(ids(players));
  });

  it('treats spawnDelay 0 as live', () => {
    const { world } = setup({}, (m) => {
      flight(m, 'enemy').spawnDelay = 0;
    });
    expect(world.pending).toHaveLength(0);
    expect(world.aircraft).toHaveLength(world.allAircraft().length);
  });

  it('never makes the player pending, even when the player flight is delayed', () => {
    const { world } = setup({ wingmen: 2 }, (m) => {
      flight(m, 'player').spawnDelay = 10;
    });
    const [player, ...wingmen] = world.flightMembers.get('player')!;
    expect(player).toBe(world.player);
    expect(player.controller).toBe('player');
    expect(world.aircraft).toContain(player);
    expect(world.pending.map((p) => p.ac)).not.toContain(player);
    expect(ids(world.pending.map((p) => p.ac))).toEqual(ids(wingmen));
  });
});

describe('buildWorld: spawnDue', () => {
  it('spawns nothing before spawnAt and everything due at exactly spawnAt', () => {
    const { world } = setup({}, (m) => {
      flight(m, 'enemy').spawnDelay = 20;
    });
    const liveBefore = world.aircraft.length;
    world.time = 19.999;
    expect(world.spawnDue()).toEqual([]);
    expect(world.aircraft).toHaveLength(liveBefore);
    expect(world.pending).toHaveLength(2);

    world.time = 20;
    const spawned = world.spawnDue();
    expect(spawned).toHaveLength(2);
    expect(world.pending).toHaveLength(0);
    // The returned list is exactly what was appended to the live list, in the same order.
    expect(ids(world.aircraft.slice(liveBefore))).toEqual(ids(spawned));
    expect(world.spawnDue()).toEqual([]);
  });

  it('leaves later spawns pending while releasing earlier ones', () => {
    const { world } = setup({ wingmen: 1 }, (m) => {
      flight(m, 'player').spawnDelay = 5;
      flight(m, 'enemy').spawnDelay = 50;
    });
    const wingman = world.flightMembers.get('player')![1];
    world.time = 5;
    expect(world.spawnDue()).toEqual([wingman]);
    expect(world.pending.map((p) => p.ac)).toEqual(world.flightMembers.get('enemy'));
  });

  // Pins current behaviour: spawnDue walks `pending` backwards, so same-tick spawns enter the
  // live list (and so the AI/sim update order) last slot of the last flight first. A change to
  // this order alters sim output and must be made on purpose, with A/B evidence.
  it('releases same-tick spawns in reverse insertion order (last slot of the last flight first)', () => {
    const { world } = setup({ wingmen: 2, enemyCount: 3 }, (m) => {
      flight(m, 'player').spawnDelay = 15;
      flight(m, 'enemy').spawnDelay = 15;
    });
    const insertion = world.pending.map((p) => p.ac);
    const wingmen = world.flightMembers.get('player')!.slice(1);
    const enemies = world.flightMembers.get('enemy')!;
    expect(ids(insertion)).toEqual(ids([...wingmen, ...enemies]));
    world.time = 15;
    expect(ids(world.spawnDue())).toEqual(ids([...insertion].reverse()));
  });
});

describe('buildWorld: ids and membership', () => {
  it('numbers aircraft 1..N in flight-then-slot order, then balloons, then ground targets', () => {
    const { world, mission } = setup({ wingmen: 2, enemyCount: 3 }, (m) => {
      flight(m, 'enemy').spawnDelay = 40; // pending members still take their ids in order
      m.balloons.push({ id: 'b1', side: 'central', x: 6000, z: 0, altitude: 800 });
      m.balloons.push({ id: 'b2', side: 'central', x: 7000, z: 0, altitude: 800 });
      m.groundTargets.push({ id: 'g1', type: 'truck', side: 'central', x: 5000, z: 500, heading: 0 });
    });
    const flat = mission.flights.flatMap((f) => world.flightMembers.get(f.id)!);
    const n = mission.flights.reduce((s, f) => s + f.members.length, 0);
    expect(ids(flat)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(ids(world.balloons)).toEqual([n + 1, n + 2]);
    expect(ids(world.groundTargets)).toEqual([n + 3]);
    expect(world.missionIdToEntity.get('b1')).toBe(n + 1);
    expect(world.missionIdToEntity.get('b2')).toBe(n + 2);
    expect(world.missionIdToEntity.get('g1')).toBe(n + 3);
    expect(world.getEntity(n + 1)).toBe(world.balloons[0]);
    expect(world.getEntity(n + 3)).toBe(world.groundTargets[0]);
    for (const ac of flat) expect(world.getEntity(ac.id)).toBe(ac);
  });

  it('keeps pending members in flightMembers in slot order; allAircraft flattens them in mission order', () => {
    const { world, mission } = setup({ wingmen: 1, enemyCount: 3 }, (m) => {
      // Delay the first flight so live-then-pending order differs from mission order.
      flight(m, 'player').spawnDelay = 25;
    });
    expect(world.pending.length).toBeGreaterThan(0);
    expect(world.aircraft.length).toBeGreaterThan(0);
    for (const f of mission.flights) {
      const members = world.flightMembers.get(f.id)!;
      expect(members).toHaveLength(f.members.length);
      expect(members.every((a) => a.flightId === f.id)).toBe(true);
      // Ids rise with slot, so ascending ids mean slot order.
      expect(ids(members)).toEqual([...ids(members)].sort((a, b) => a - b));
    }
    expect(world.allAircraft()).toEqual(mission.flights.flatMap((f) => world.flightMembers.get(f.id)!));
    expect(world.allAircraft()).toHaveLength(world.aircraft.length + world.pending.length);
  });
});

describe('buildWorld: start offsets', () => {
  it('places an air-start flight on formationOffset() slots relative to the leader (heading 0)', () => {
    const { world } = setup({ wingmen: 3 }, (m) => {
      flight(m, 'player').start.heading = 0;
    });
    const [lead, ...rest] = world.flightMembers.get('player')!;
    rest.forEach((ac, i) => {
      const o = formationOffset(i + 1);
      const d = ac.state.position.clone().sub(lead.state.position);
      // Heading 0: right = +x, back = +z.
      expect(d.x).toBeCloseTo(o.right, 6);
      expect(d.z).toBeCloseTo(o.back, 6);
      expect(d.y).toBeCloseTo(o.up, 6);
    });
    expect(rest[0].state.position.x).toBeGreaterThan(lead.state.position.x); // slot 1 to the right
    expect(rest[0].state.position.z).toBeGreaterThan(lead.state.position.z); // and behind
  });

  it('lines a ground-start flight up 45 m apart, staggered right/left, at rest', () => {
    const { world } = setup({ wingmen: 3 }, (m) => {
      const f = flight(m, 'player');
      f.start.heading = 0;
      f.startOnGround = true;
    });
    const members = world.flightMembers.get('player')!;
    const lead = members[0];
    members.forEach((ac, slot) => {
      const d = ac.state.position.clone().sub(lead.state.position);
      expect(d.z).toBeCloseTo(slot * 45, 6);
      expect(d.y).toBeCloseTo(0, 6);
      if (slot > 0) expect(Math.sign(d.x)).toBe(slot % 2 === 1 ? 1 : -1);
      expect(ac.state.airspeed).toBe(0);
      expect(ac.controls.throttle).toBe(0);
    });
    // Ground lineup differs from the air formation.
    expect(members[1].state.position.x - lead.state.position.x).not.toBeCloseTo(formationOffset(1).right, 3);
  });
});
