import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { MissionFlight, Waypoint } from '../core/types';
import { createAIController } from './controller';
import { makeAircraft, runScenario, TestWorld, TEST_REALISM } from './testing/testWorld';

describe('strafing target choice', () => {
  it('attacks the battery, not the flak gun sited next to the waypoint to defend it', () => {
    const wps: Waypoint[] = [{ x: 7000, z: 0, altitude: 800, action: 'attack-ground' }];
    const f: MissionFlight = {
      id: 'g', role: 'friendly', side: 'allied', nation: 'britain', aircraftId: 'sopwith_camel', members: [],
      start: { x: 0, z: 0, altitude: 800, heading: Math.PI / 2, airspeed: 45 }, waypoints: wps, task: 'ground-attack',
    };
    const world = new TestWorld({ frontX: 3000, flights: [f] });
    const flak = { id: 801, kind: 'ground' as const, type: 'aa-gun' as const, side: 'central' as const, position: new Vector3(7000, 50, 0), heading: 0, health: 1, destroyed: false };
    const battery = { id: 802, kind: 'ground' as const, type: 'artillery' as const, side: 'central' as const, position: new Vector3(7300, 50, 400), heading: 0, health: 1, destroyed: false };
    world.groundTargets.push(flak, battery);
    const ac = makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: 0, alt: 800, heading: Math.PI / 2, flightId: 'g' });
    world.aircraft.push(ac);
    const ctl = createAIController(ac, { role: 'friendly', task: 'ground-attack', skill: 'veteran', realism: TEST_REALISM, controlLaw: 'generic' });
    const chosen = new Set<number>();
    runScenario(world, new Map([[ac.id, ctl]]), 150, {
      onStep: () => {
        const id = (ctl as unknown as { attackObjId: number | null }).attackObjId;
        if (id != null) chosen.add(id);
      },
    });
    expect([...chosen]).toEqual([battery.id]);
  });
});
