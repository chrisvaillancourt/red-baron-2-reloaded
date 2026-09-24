import { describe, expect, it } from 'vitest';
import type { AIController } from '../core/interfaces';
import type { AircraftEntity, AircraftId, MissionFlight, SkillLevel } from '../core/types';
import { createAIController, type AIPilot } from './controller';
import { angleBetween, forwardOf } from './math';
import { leadSolution } from './gunnery';
import { makeAircraft, runScenario, TestWorld, TEST_REALISM } from './testing/testWorld';

function flight(id: string, side: 'allied' | 'central', task: MissionFlight['task'], extra: Partial<MissionFlight> = {}): MissionFlight {
  return {
    id, role: 'friendly', side, nation: side === 'allied' ? 'britain' : 'germany', aircraftId: 'se5a', members: [],
    start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 50 }, waypoints: [], task, ...extra,
  };
}

function ai(ac: AircraftEntity, skill: SkillLevel, extra: Partial<Parameters<typeof createAIController>[1]> = {}): AIPilot {
  return createAIController(ac, { role: ac.side === 'allied' ? 'friendly' : 'enemy', task: 'fighter-sweep', skill, realism: TEST_REALISM, ...extra });
}

function applyHits(world: TestWorld, dt: number, killAt: number): void {
  for (const sh of world.aircraft) {
    if (!sh.controls.fireGuns || sh.outcome) continue;
    const f = forwardOf(sh.state.orientation);
    for (const v of world.aircraft) {
      if (v.side === sh.side || v.outcome) continue;
      const r = v.state.position.distanceTo(sh.state.position);
      if (r > 350) continue;
      const sol = leadSolution(sh.state.position, sh.state.velocity, v.state.position, v.state.velocity, null, 800);
      if (angleBetween(f, sol.dir) < Math.atan2(4, r) + 0.004) {
        v.damage.zones.fuselage += (8 * dt) / killAt;
        v.damage.lastAttackerId = sh.id;
        if (v.damage.zones.fuselage >= 1) {
          v.damage.destroyed = true;
          v.outcome = 'shot-down';
        }
      }
    }
  }
}

describe('AI furball & escort (point-mass physics)', () => {
  it('4v4 mixed-skill furball: kills happen, nobody flies into the ground or rams anyone', () => {
    const world = new TestWorld({ frontX: 50000 });
    const skills: SkillLevel[] = ['novice', 'regular', 'veteran', 'ace'];
    const types: AircraftId[][] = [
      ['fokker_dri', 'albatros_dv', 'fokker_dvii', 'pfalz_diiia'],
      ['sopwith_camel', 'se5a', 'spad_xiii', 'sopwith_triplane'],
    ];
    const all: AircraftEntity[] = [];
    for (let i = 0; i < 4; i++) {
      all.push(makeAircraft({ aircraftId: types[0][i], side: 'central', x: i * 60, z: -1500 - i * 40, alt: 1800 + i * 30, heading: Math.PI, flightId: 'c', skill: skills[i] }));
      all.push(makeAircraft({ aircraftId: types[1][i], side: 'allied', x: i * 60 + 30, z: 1500 + i * 40, alt: 1700 + i * 30, heading: 0, flightId: 'a', skill: skills[3 - i] }));
    }
    world.aircraft.push(...all);
    const ctls = new Map<number, AIController>(all.map((p, i) => [p.id, ai(p, p.skill, { seed: 40 + i })]));
    let closeCalls = 0;
    runScenario(world, ctls, 180, {
      onStep: (t) => {
        applyHits(world, 1 / 120, 40);
        if (Math.round(t * 120) % 12 !== 0) return;
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++)
            if (!all[i].outcome && !all[j].outcome && all[i].state.position.distanceTo(all[j].state.position) < 8) closeCalls++;
      },
    });
    const crashed = all.filter((a) => a.outcome === 'crashed');
    const kills = all.filter((a) => a.outcome === 'shot-down');
    const fired = all.filter((a) => (ctls.get(a.id) as AIPilot).stats.firingTime > 0);
    expect(crashed.map((a) => `${a.spec.id} ${(ctls.get(a.id) as AIPilot).debugState}`)).toEqual([]);
    expect(kills.length).toBeGreaterThan(0);
    expect(fired.length).toBeGreaterThanOrEqual(4);
    expect(closeCalls).toBeLessThan(3);
  });

  it('escorts stay with their two-seater and turn on an attacker', () => {
    const recon = flight('r', 'allied', 'recon', { waypoints: [{ x: 20000, z: -20000, altitude: 2000, action: 'fly' }] });
    const esc = flight('e', 'allied', 'escort', { escortFlightId: 'r' });
    const world = new TestWorld({ frontX: 50000, flights: [recon, esc] });
    const r = makeAircraft({ aircraftId: 're8', side: 'allied', x: 0, z: 0, alt: 2000, heading: Math.PI / 4, flightId: 'r' });
    const e1 = makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: -100, z: 300, alt: 2300, heading: Math.PI / 4, flightId: 'e' });
    world.aircraft.push(r, e1);
    const ctls = new Map<number, AIController>([
      [r.id, ai(r, 'regular', { task: 'recon' })],
      [e1.id, ai(e1, 'veteran', { task: 'escort' })],
    ]);
    let maxSep = 0;
    runScenario(world, ctls, 90, {
      onStep: (t) => {
        if (t > 20) maxSep = Math.max(maxSep, r.state.position.distanceTo(e1.state.position));
      },
    });
    expect(maxSep).toBeLessThan(900);
    // An enemy scout closes on the two-seater from behind.
    const bandit = makeAircraft({ aircraftId: 'albatros_dv', side: 'central', x: r.state.position.x - 900, z: r.state.position.z + 900, alt: 2000, heading: Math.PI / 4, flightId: 'b', speed: 55 });
    world.aircraft.push(bandit);
    let engaged = false;
    runScenario(world, ctls, 160, {
      onStep: () => {
        if ((ctls.get(e1.id) as AIPilot).targetId === bandit.id) engaged = true;
      },
    });
    expect(engaged).toBe(true);
  });
});
