/**
 * Fighters and bombers on the real flight model (docs/ai.md "Bombers"): interceptors go for
 * the bombers rather than their escort and attack from the bombers' blind spots; escorts stay
 * with their bombers and break off to engage the fighters attacking them.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, Waypoint } from '../core/types';
import { inGunnersArcs } from './bombing';
import { TACTICS_FLAGS } from './tactics';
import { runSim, SimWorld } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';

const EAST = Math.PI / 2;
const far: Waypoint[] = [{ x: 60000, z: 0, altitude: 2500, action: 'fly' }];

/**
 * A pair of D.H.4s flying east in formation, and a veteran Fokker D.VII meeting them from
 * `from` (m, relative to the leader). A formation flies slower than a lone D.H.4, which
 * outruns most scouts.
 */
function duel(seed: number, from: Vector3) {
  const world = new SimWorld({ seed, frontX: -100000 });
  world.addFlight(routeFlight('b', 'allied', 'dh4', far, { task: 'bomb' }));
  world.addFlight(routeFlight('e', 'central', 'fokker_dvii', [], { task: 'defend' }));
  const bomber = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: 0, z: 0, alt: 2500, heading: EAST, flightId: 'b' });
  world.addAI(bomber, 'regular', { role: 'friendly', task: 'bomb' });
  const wing = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: -36, z: 45, alt: 2506, heading: EAST, flightId: 'b' });
  world.addAI(wing, 'regular', { role: 'friendly', task: 'bomb', leaderId: bomber.id, formationSlot: 1 });
  const hdg = Math.atan2(-from.x, from.z); // toward the bomber: forward (sin h, -cos h) = -from
  const dv = world.addAircraft({ aircraftId: 'fokker_dvii', side: 'central', x: from.x, z: from.z, alt: 2500 + from.y, heading: hdg, flightId: 'e', skill: 'veteran' });
  world.addAI(dv, 'veteran', { role: 'enemy', task: 'defend' });
  return { world, bombers: [bomber, wing], dv };
}

function blindShare(on: boolean) {
  const prev = TACTICS_FLAGS.blindSpot;
  TACTICS_FLAGS.blindSpot = on;
  let close = 0;
  let blind = 0;
  let hitsTaken = 0;
  let hitsGiven = 0;
  try {
    // Ahead of the formation, as interceptors meet a raid, from either side and above.
    const starts = [new Vector3(2500, 100, 400), new Vector3(2200, 300, -800), new Vector3(1800, 0, 1200), new Vector3(3000, 200, 0)];
    for (let seed = 1; seed <= 8; seed++) {
      const { world, bombers, dv } = duel(seed, starts[seed % starts.length]);
      runSim(world, 150, {
        onStep: () => {
          if (dv.outcome !== null) return true;
          for (const b of bombers) {
            if (b.outcome !== null || dv.state.position.distanceTo(b.state.position) > 700) continue;
            close++;
            if (!inGunnersArcs(b, dv.state.position)) blind++;
          }
        },
      });
      for (const e of world.eventsOf('bullet-hit')) {
        if (e.targetId === dv.id) hitsTaken++;
        if (bombers.some((b) => b.id === e.targetId)) hitsGiven++;
      }
    }
  } finally {
    TACTICS_FLAGS.blindSpot = prev;
  }
  return { share: blind / Math.max(1, close), hitsTaken, hitsGiven, close };
}

describe('fighters against bombers on the real flight model', { timeout: 60_000 }, () => {
  it('attackers keep out of a bomber\'s fields of fire and take fewer hits from its gunner', () => {
    const off = blindShare(false);
    const on = blindShare(true);
    process.stdout.write(`blind spot off: ${JSON.stringify(off)}\nblind spot on:  ${JSON.stringify(on)}\n`);
    // Measured: 57% of the time within 700 m out of the gunners' arcs and 33 hits taken,
    // against 87% and 5, for about the same hits on the bombers (8 seeds).
    expect(on.share).toBeGreaterThan(off.share + 0.1);
    expect(on.hitsTaken).toBeLessThan(off.hitsTaken);
    expect(on.hitsGiven).toBeGreaterThan(off.hitsGiven * 0.7);
  });

  it('interceptors go for the bombers, not an escort that leaves them alone', () => {
    const world = new SimWorld({ seed: 3, frontX: -100000 });
    world.addFlight(routeFlight('b', 'allied', 'dh4', far, { task: 'bomb' }));
    world.addFlight(routeFlight('x', 'allied', 'sopwith_camel', far, { task: 'escort', escortFlightId: 'b' }));
    world.addFlight(routeFlight('e', 'central', 'albatros_dv', [], { task: 'defend' }));
    const dv = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 0, z: 0, alt: 2500, heading: EAST, flightId: 'e', skill: 'veteran' });
    const ctl = world.addAI(dv, 'veteran', { role: 'enemy', task: 'defend' });
    // The escort crosses 250 m ahead, the bombers are 2.5 km out: both northbound.
    const camel = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 250, z: 60, alt: 2520, heading: 0, flightId: 'x' });
    const bomber = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: 2400, z: 600, alt: 2500, heading: 0, flightId: 'b' });
    world.addAI(camel, 'regular', { role: 'friendly', task: 'escort', avoidCollisions: true });
    world.addAI(bomber, 'regular', { role: 'friendly', task: 'bomb' });
    let onBomber = 0;
    let onEscort = 0;
    runSim(world, 4, {
      onStep: () => {
        if (ctl.targetId === bomber.id) onBomber++;
        if (ctl.targetId === camel.id) onEscort++;
      },
    });
    expect(onBomber).toBeGreaterThan(0);
    expect(onEscort).toBe(0);
  });
});

/** Two D.H.4s flying east, a Camel escorting them from its station above and behind. */
function escorted(seed: number) {
  const world = new SimWorld({ seed, frontX: -100000 });
  world.addFlight(routeFlight('b', 'allied', 'dh4', far, { task: 'bomb' }));
  world.addFlight(routeFlight('x', 'allied', 'sopwith_camel', far, { task: 'escort', escortFlightId: 'b' }));
  const lead = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: 0, z: 0, alt: 2500, heading: EAST, flightId: 'b' });
  const wing = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: -36, z: 45, alt: 2506, heading: EAST, flightId: 'b' });
  world.addAI(lead, 'regular', { role: 'friendly', task: 'bomb' });
  world.addAI(wing, 'regular', { role: 'friendly', task: 'bomb', leaderId: lead.id, formationSlot: 1 });
  const camel = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: -250, z: 0, alt: 2800, heading: EAST, flightId: 'x' });
  const esc = world.addAI(camel, 'regular', { role: 'friendly', task: 'escort' });
  return { world, bombers: [lead, wing], camel, esc };
}
const fromBombers = (a: AircraftEntity, bombers: AircraftEntity[]) => Math.min(...bombers.filter((b) => b.outcome === null).map((b) => b.state.position.distanceTo(a.state.position)));

describe('escorts on the real flight model', { timeout: 60_000 }, () => {
  it('stay with their bombers while an enemy scout only shadows them', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { world, bombers, camel, esc } = escorted(seed);
      // A D.V flying alongside 1.3 km off, not attacking (a recon task never engages).
      world.addFlight(routeFlight('e', 'central', 'albatros_dv', far, { task: 'recon' }));
      const dv = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 200, z: -1300, alt: 2600, heading: EAST, flightId: 'e' });
      world.addAI(dv, 'regular', { role: 'enemy', task: 'recon' });
      let chased = 0;
      let farthest = 0;
      runSim(world, 60, {
        onStep: (t) => {
          if (esc.targetId === dv.id) chased++;
          if (t > 10) farthest = Math.max(farthest, fromBombers(camel, bombers));
        },
      });
      expect(chased, `seed ${seed}: steps chasing the shadower`).toBe(0);
      expect(farthest, `seed ${seed}`).toBeLessThan(700);
    }
  });

  it('break off to engage a scout attacking their bombers', () => {
    let engaged = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { world, esc } = escorted(seed);
      world.addFlight(routeFlight('e', 'central', 'albatros_dv', [], { task: 'defend' }));
      // Coming in from ahead and above to attack the formation.
      const dv = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 2200, z: 300, alt: 2700, heading: -EAST, flightId: 'e', skill: 'veteran' });
      world.addAI(dv, 'veteran', { role: 'enemy', task: 'defend' });
      let on = false;
      runSim(world, 90, { onStep: () => void (on ||= esc.targetId === dv.id) });
      if (on) engaged++;
    }
    expect(engaged).toBe(3);
  });
});

export type { AircraftEntity };
