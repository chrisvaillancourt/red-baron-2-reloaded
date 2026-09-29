/**
 * The AI's gunners on a type with several (docs/ai.md "Bombers"): each crew member gets the
 * enemy his own stations bear on, through setGunnerTarget(ac, id, station), and a dead man
 * gets nothing. TEST_TWIN (src/sim/testing) stands in for the Gotha: a nose gunner, and a
 * rear gunner working the dorsal ring and the ventral tunnel.
 */
import { describe, expect, it } from 'vitest';
import type { CrewStationId } from '../core/types';
import { createAircraftEntity } from '../sim';
import { TEST_TWIN } from '../sim/testing/fixtures';
import { createAIController } from './controller';
import { SimWorld, STANDARD_REALISM } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';

describe('AI gunners per station', () => {
  it('each gunner takes the enemy his stations bear on, and a dead man none', () => {
    const world = new SimWorld({ frontX: -100000 });
    world.addFlight(routeFlight('g', 'central', 'albatros_dv', [{ x: 0, z: -60000, altitude: 2500, action: 'fly' }], { task: 'bomb' }));
    const twin = createAircraftEntity({ id: 50, spec: TEST_TWIN, nation: 'germany', flightId: 'g', env: world.env, start: { x: 0, z: 0, altitude: 2500, heading: 0, airspeed: 36 } });
    world.aircraft.push(twin);
    // Heading north (-z): one scout ahead, one below and behind, 300 m out.
    const ahead = world.addAircraft({ side: 'allied', aircraftId: 'se5a', x: 0, z: -300, alt: 2520, heading: Math.PI, controller: 'none' });
    const below = world.addAircraft({ side: 'allied', aircraftId: 'se5a', x: 0, z: 260, alt: 2350, heading: 0, controller: 'none' });
    const calls: [number | null, CrewStationId | undefined][] = [];
    const ai = createAIController(twin, { role: 'enemy', task: 'bomb', skill: 'regular', realism: STANDARD_REALISM, setGunnerTarget: (_ac, id, st) => void calls.push([id, st]) });
    ai.update(twin, world, 1 / 30);
    expect(calls).toContainEqual([ahead.id, 'nose']);
    expect(calls).toContainEqual([below.id, 'ventral']);
    expect(calls.some(([, st]) => st === undefined)).toBe(false);
    // The rear gunner is killed: his override is cleared, and he gets nothing new.
    twin.damage.crewWounds = [0, 0, 1];
    calls.length = 0;
    ai.update(twin, world, 1 / 30);
    expect(calls).toEqual([[null, 'ventral']]);
  });
});
