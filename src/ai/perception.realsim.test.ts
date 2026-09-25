/**
 * Real sim: an enemy diving in straight out of the sun is spotted much later than
 * the same approach with the sun behind the observer. The observer is a real AI
 * (regular S.E.5a loitering at 2 km); the attacker is placed kinematically on the
 * line from the sun, closing at 70 m/s, so both runs fly the same geometry up to
 * the moment of spotting.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEG } from './math';
import { perceptionOf } from './perception';
import { runSim, SimWorld } from './testing/realSimHarness';

const UP_EAST = new Vector3(Math.cos(30 * DEG), Math.sin(30 * DEG), 0);
const UP_WEST = new Vector3(-Math.cos(30 * DEG), Math.sin(30 * DEG), 0);

/** Range (m) at which the observer first has the attacker in its contacts. */
function spotRange(sun: Vector3, seed: number): number {
  const world = new SimWorld({ sunDirection: sun });
  const obs = world.addAircraft({ side: 'allied', aircraftId: 'se5a', x: 0, z: 0, alt: 2000, heading: Math.PI / 2 + (seed - 3) * 0.1 });
  world.addAI(obs, 'regular', { seed });
  const att = world.addAircraft({ side: 'central', aircraftId: 'albatros_dv', x: 4500, z: 0, alt: 4000, heading: -Math.PI / 2, controller: 'none' });
  const closing = 70;
  let r = 4500;
  let found = NaN;
  runSim(world, 70, {
    onStep: () => {
      r -= closing * (1 / 120);
      att.state.position.copy(obs.state.position).addScaledVector(UP_EAST, r);
      att.state.velocity.copy(UP_EAST).multiplyScalar(-closing);
      if (perceptionOf(obs)?.contact(att.id)) {
        found = r;
        return true;
      }
      return r < 150;
    },
  });
  return Number.isNaN(found) ? 150 : found;
}

describe('perception on the real sim', () => {
  it('an attack out of the sun is spotted much later', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const inSun = seeds.map((s) => spotRange(UP_EAST, s));
    const clear = seeds.map((s) => spotRange(UP_WEST, s));
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    console.info(`[perception] spotted at: out of the sun ${inSun.map((x) => x.toFixed(0)).join(' ')} m; sun behind ${clear.map((x) => x.toFixed(0)).join(' ')} m`);
    // A regular sees 3.4 km in clear air and ~0.18 of that in the sun's core.
    expect(mean(clear)).toBeGreaterThan(2500);
    expect(mean(inSun)).toBeLessThan(0.4 * mean(clear));
  });
});
