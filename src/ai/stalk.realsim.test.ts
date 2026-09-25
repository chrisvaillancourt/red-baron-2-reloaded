/**
 * Stalking on the real flight model: an ace with the 'stalker' signature and an unaware,
 * patrolling target works round to the sun's bearing and comes down the sun line, so
 * perception's glare hides him. Entry geometry is taken where he closes inside 600 m,
 * over five start bearings, against the same ace with stalking switched off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AircraftEntity } from '../core/types';
import { sunDirectionFor } from '../world/sun';
import { likelySpottedBy, sunAngle } from './perception';
import { TACTICS_FLAGS } from './tactics';
import { runSim, SimWorld } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';

const DEG = Math.PI / 180;
const SEEDS = [1, 2, 3, 4, 5];

interface Entry {
  dh: number;
  sunDeg: number;
  /** Had the target spotted the ace by the time it closed inside 600 m? */
  seen: boolean;
  t: number;
}

function firstPass(seed: number): Entry | null {
  // A late-autumn afternoon: the sun low in the south-west, as it was for much of the fighting season.
  const date = '1917-11-10';
  const sun = sunDirectionFor(date, 'afternoon');
  const target = routeFlight('t', 'allied', 'nieuport_17', [{ x: 0, z: -1500, altitude: 2000, action: 'patrol', duration: 900 }]);
  const world = new SimWorld({ flights: [target], frontX: 1e6, date, sunDirection: sun, seed });
  const tgt = world.addAircraft({ aircraftId: 'nieuport_17', side: 'allied', x: 0, z: 0, alt: 2000, heading: 0, flightId: 't' });
  world.addAI(tgt, 'novice');
  // Behind the target's tail (in a novice's blind cone), 3 km back and a little above, as a
  // patrolling ace would be.
  const ace: AircraftEntity = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 1200 * (seed - 3), z: 3500, alt: 2300, heading: 0 });
  world.addAI(ace, 'ace', { tactics: 'stalker', seed });
  let entry: Entry | null = null;
  // Entry geometry: where the ace was the last time it was outside 600 m of the target.
  let outside: Entry | null = null;
  let seen = 0;
  runSim(world, 400, {
    onStep: (t) => {
      if (ace.state.position.distanceTo(tgt.state.position) > 600) {
        outside = { dh: ace.state.position.y - tgt.state.position.y, sunDeg: sunAngle(tgt.state.position, ace.state.position, world) / DEG, seen: likelySpottedBy(ace, tgt, world), t };
      }
      for (; seen < world.events.length; seen++) {
        const e = world.events[seen];
        if (!entry && e.type === 'gun-fired' && e.shooterId === ace.id) entry = outside;
      }
      return entry !== null;
    },
  });
  return entry;
}

describe('stalking (real sim)', { timeout: 120_000 }, () => {
  afterEach(() => {
    TACTICS_FLAGS.stalk = true;
  });

  it('a stalker ace comes at an unaware target out of a low sun, unseen, far more often than without stalking', () => {
    const run = () => SEEDS.map(firstPass);
    TACTICS_FLAGS.stalk = true;
    const on = run();
    TACTICS_FLAGS.stalk = false;
    const off = run();
    const upSun = (xs: (Entry | null)[]) => xs.filter((e) => e && e.sunDeg < 16).length;
    const unseen = (xs: (Entry | null)[]) => xs.filter((e) => e && !e.seen).length;
    const fmt = (xs: (Entry | null)[]) => xs.map((e) => (e ? `dh ${e.dh.toFixed(0)} sun ${e.sunDeg.toFixed(0)}° ${e.seen ? 'seen' : 'unseen'} t ${e.t.toFixed(0)}` : 'none')).join('; ');
    const msg = `on: ${fmt(on)}\noff: ${fmt(off)}`;
    if (process.env.STALK_DEBUG) process.stdout.write(msg + '\n');
    expect(on.filter(Boolean).length, msg).toBeGreaterThanOrEqual(4);
    expect(upSun(on), msg).toBeGreaterThanOrEqual(3);
    expect(upSun(on), msg).toBeGreaterThan(upSun(off));
    expect(unseen(on), msg).toBeGreaterThanOrEqual(3);
    expect(unseen(on), msg).toBeGreaterThan(unseen(off));
  });
});
