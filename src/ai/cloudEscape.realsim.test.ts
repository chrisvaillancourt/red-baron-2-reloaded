/**
 * Cloud escape on the real flight model: a wounded pilot heading home with an enemy
 * scout behind him makes for a nearby cumulus, and the pursuer, who can't see into it,
 * hunts where he was going instead of reading his true position. Compared on the same
 * seeds with escape and memory pursuit switched off. Measures time in cloud and time the
 * pursuer spends without sight of him, and the hits he takes (in cloud and in all).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Weather } from '../core/types';
import { perceptionOf } from './perception';
import { TACTICS_FLAGS } from './tactics';
import { runSim, SimWorld } from './testing/realSimHarness';

const CUMULUS: Weather = { cloudCover: 0.55, cloudBaseM: 1500, cloudTopM: 2400, wind: [0, 0, 0], visibilityM: 25_000, turbulence: 0 };
const SEEDS = [1, 2, 3, 4, 5, 6];

interface Outcome {
  /** Seconds the pursuer spent without sight of him. */
  lostS: number;
  hitsTaken: number;
  inCloudS: number;
  /** Hits taken while he was inside cloud (density > 0.3). */
  hitsInCloud: number;
  /** Hits taken while the pursuer did not see him (remembered or forgotten). */
  hitsUnseen: number;
  /** Hits taken within a minute of first entering cloud. */
  hitsAfterEntry: number;
  /** Mission time he first entered cloud, or -1. */
  entryAt: number;
}

function escape(seed: number): Outcome {
  const world = new SimWorld({ weather: CUMULUS, seed, frontX: -1e6, realFront: false });
  // The nearest cloud to the origin decides where the fight starts: 1.5 km short of it.
  const c = world.nearestCloud!(new Vector3(0, 1800, 0), 12_000)!;
  const heading = Math.atan2(c.position.x, -c.position.z) + (seed - 3.5) * 0.25;
  const start = c.position.clone().add(new Vector3(-Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(900 + c.radius));
  const hurt = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: start.x, z: start.z, alt: c.position.y, heading });
  hurt.damage.pilotWounded = true;
  hurt.damage.zones.pilot = 0.3;
  world.addAI(hurt, 'regular', { seed });
  const back = new Vector3(-Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(1300);
  const hunter = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: start.x + back.x, z: start.z + back.z, alt: c.position.y + 30, heading });
  world.addAI(hunter, 'veteran', { seed: seed + 100 });
  const per = perceptionOf(hunter)!;
  let lostS = 0;
  let inCloudS = 0;
  let hitsInCloud = 0;
  let hitsUnseen = 0;
  let hitsAfterEntry = 0;
  let entryAt = -1;
  let t = 0;
  let nEv = 0;
  runSim(world, 90, {
    onStep: () => {
      t += 1 / 120;
      const k = per.contact(hurt.id);
      const unseen = !k || !k.visible;
      if (unseen) lostS += 1 / 120;
      const p = hurt.state.position;
      const inCloud = world.cloudDensityAt!(p.x, p.y, p.z) > 0.3;
      if (inCloud) {
        inCloudS += 1 / 120;
        if (entryAt < 0) entryAt = t;
      }
      for (; nEv < world.events.length; nEv++) {
        const e = world.events[nEv];
        if (e.type !== 'bullet-hit' || e.targetId !== hurt.id) continue;
        if (inCloud) hitsInCloud++;
        if (unseen) hitsUnseen++;
        if (entryAt >= 0 && t - entryAt < 60) hitsAfterEntry++;
      }
      return !!hurt.outcome;
    },
  });
  const hitsTaken = world.eventsOf('bullet-hit').filter((e) => e.targetId === hurt.id).length;
  return { lostS, hitsTaken, inCloudS, hitsInCloud, hitsUnseen, hitsAfterEntry, entryAt };
}

describe('cloud escape (real sim)', { timeout: 120_000 }, () => {
  afterEach(() => {
    TACTICS_FLAGS.cloudEscape = true;
    TACTICS_FLAGS.memoryPursuit = true;
  });

  it('a wounded pilot makes for cloud and his pursuer loses sight of him far longer', () => {
    const on = SEEDS.map(escape);
    TACTICS_FLAGS.cloudEscape = false;
    TACTICS_FLAGS.memoryPursuit = false;
    const off = SEEDS.map(escape);
    const sum = (xs: Outcome[], k: keyof Outcome) => xs.reduce((a, o) => a + o[k], 0);
    const fmt = (xs: Outcome[]) =>
      xs.map((o) => `lost ${o.lostS.toFixed(0)}s cloud ${o.inCloudS.toFixed(0)}s (in at ${o.entryAt.toFixed(0)}s) hits ${o.hitsTaken} (in cloud ${o.hitsInCloud}, unseen ${o.hitsUnseen}, <60 s after entry ${o.hitsAfterEntry})`).join('\n  ');
    const tot = (xs: Outcome[]) => `hits ${sum(xs, 'hitsTaken')} in-cloud ${sum(xs, 'hitsInCloud')} unseen ${sum(xs, 'hitsUnseen')} cloud ${sum(xs, 'inCloudS').toFixed(0)}s lost ${sum(xs, 'lostS').toFixed(0)}s`;
    const msg = `on (${tot(on)}):\n  ${fmt(on)}\noff (${tot(off)}):\n  ${fmt(off)}`;
    if (process.env.ESCAPE_DEBUG) process.stdout.write(msg + '\n');
    expect(sum(on, 'inCloudS'), msg).toBeGreaterThan(sum(off, 'inCloudS') + 30);
    expect(sum(on, 'lostS'), msg).toBeGreaterThan(sum(off, 'lostS') * 1.5);
    // Cloud has to save him, not just hide him (DECISIONS "Cloud blinds at close range"):
    // a pursuer ~100 m behind can't see into a core, and neither follows his true position
    // nor fires at him while cloud hides him; he circles the core for 25-40 s. Before that,
    // 162 of 196 hits landed while he was inside cloud and in sight (213 with no refuge).
    expect(sum(on, 'hitsTaken'), msg).toBeLessThan(sum(off, 'hitsTaken') * 0.5);
    // Nothing lands while the pursuer can't see him.
    expect(sum(on, 'hitsUnseen'), msg).toBe(0);
  });
});
