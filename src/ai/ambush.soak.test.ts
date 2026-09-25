/**
 * Attack entry by skill where stalking can apply (AI_SOAK=ambush): an attacker 3.5 km
 * behind an unaware patrolling Nieuport 17, a little above it, under a low late-autumn
 * afternoon sun (the stalk.realsim.test.ts geometry). For each attacker skill (and the
 * ace 'stalker' signature) it reports, for the first firing pass, the share entered from
 * above (≥100 m), from up-sun (within 15° of the sun as the target sees it), and unseen
 * by the target. The head-on quick fight can't show this: both flights see each other
 * at the start (docs/ai.md "Wave 8").
 *
 *   AI_SOAK=ambush AI_AMBUSH_REPS=12 [AI_TACTICS=stalk=0] pnpm vitest run src/ai/ambush.soak.test.ts
 */
import { describe, it } from 'vitest';
import type { AircraftEntity, SkillLevel } from '../core/types';
import { sunDirectionFor } from '../world/sun';
import { likelySpottedBy, sunAngle } from './perception';
import { applyTacticsFlagsFromEnv } from './tactics';
import type { AceTactics } from '../data/aces';
import { runSim, SimWorld } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
applyTacticsFlagsFromEnv(process.env);
const REPS = Number(process.env.AI_AMBUSH_REPS ?? 12);
const DEG = Math.PI / 180;

interface Entry { dh: number; sunDeg: number; seen: boolean }

function firstPass(skill: SkillLevel, tactics: AceTactics | undefined, rep: number): Entry | null {
  const date = '1917-11-10';
  const sun = sunDirectionFor(date, 'afternoon');
  const target = routeFlight('t', 'allied', 'nieuport_17', [{ x: 0, z: -1500, altitude: 2000, action: 'patrol', duration: 900 }]);
  const world = new SimWorld({ flights: [target], frontX: 1e6, date, sunDirection: sun, seed: rep + 1 });
  const tgt = world.addAircraft({ aircraftId: 'nieuport_17', side: 'allied', x: 0, z: 0, alt: 2000, heading: 0, flightId: 't' });
  world.addAI(tgt, 'novice');
  // Spread start bearings across the target's rear quarter.
  const x = 600 * ((rep % 7) - 3);
  const ace: AircraftEntity = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x, z: 3500, alt: 2300, heading: 0 });
  world.addAI(ace, skill, { tactics, seed: rep + 1 });
  let entry: Entry | null = null;
  let outside: Entry | null = null;
  let seen = 0;
  runSim(world, 420, {
    onStep: () => {
      if (ace.state.position.distanceTo(tgt.state.position) > 600) {
        outside = { dh: ace.state.position.y - tgt.state.position.y, sunDeg: sunAngle(tgt.state.position, ace.state.position, world) / DEG, seen: likelySpottedBy(ace, tgt, world) };
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

describe.skipIf(!SOAK.includes('ambush'))('attack entry by skill (ambush geometry)', () => {
  it('reports above / up-sun / unseen shares of first passes', { timeout: 3_600_000 }, () => {
    const rows: [string, SkillLevel, AceTactics | undefined][] = [
      ['novice', 'novice', undefined],
      ['regular', 'regular', undefined],
      ['veteran', 'veteran', undefined],
      ['ace', 'ace', undefined],
      ['ace stalker', 'ace', 'stalker'],
    ];
    const out: string[] = [`ambush entry, ${REPS} reps, AI_TACTICS=${process.env.AI_TACTICS ?? '(default)'}`];
    for (const [label, skill, tactics] of rows) {
      const es = Array.from({ length: REPS }, (_, r) => firstPass(skill, tactics, r));
      const got = es.filter((e): e is Entry => e !== null);
      const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, got.length))}%`;
      out.push(
        `${label.padEnd(12)} passes ${got.length}/${REPS}  above ${pct(got.filter((e) => e.dh >= 100).length)}  up-sun ${pct(got.filter((e) => e.sunDeg < 15).length)}  above-or-sun ${pct(got.filter((e) => e.dh >= 100 || e.sunDeg < 15).length)}  unseen ${pct(got.filter((e) => !e.seen).length)}`,
      );
    }
    process.stdout.write(out.join('\n') + '\n');
  });
});
