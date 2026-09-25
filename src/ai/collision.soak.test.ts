/**
 * Mid-air collision survey (AI_SOAK=collision) on the real sim and combat.
 *   AI_SOAK=collision AI_SEEDS=40 pnpm vitest run src/ai/collision.soak.test.ts
 * Scenarios: 4v4 head-on furballs, the same with the allied leader flown "like a human"
 * (no collision avoidance of its own), and a 5-ship vic following a leader through hard
 * turns. Reports collisions by pair and geometry, plus kills and time to first kill so
 * avoidance that makes the AI timid shows up too.
 */
import { describe, it } from 'vitest';
import { furball, tally, vic, type Tally } from './testing/collisionScenarios';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const SEEDS = Number(process.env.AI_SEEDS ?? 30);

function report(name: string, t: Tally): string {
  const n = [...t.collisions.values()].reduce((s, v) => s + v, 0);
  const fk = [...t.firstKill].sort((a, b) => a - b);
  return [
    `${name}: runs ${t.runs} collisions ${n} (${((100 * n) / t.runs).toFixed(0)} per 100 runs) kills/run ${(t.kills / t.runs).toFixed(2)} median first kill ${fk.length ? fk[fk.length >> 1].toFixed(0) : '-'}s${t.humanLost ? ` human leader lost ${t.humanLost}` : ''}`,
    ...[...t.collisions].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${v} ${k}`),
  ].join('\n');
}

describe.skipIf(!SOAK.includes('collision'))('soak: mid-air collisions', () => {
  it('survey', () => {
    const f = tally();
    const h = tally();
    const v = tally();
    for (let s = 1; s <= SEEDS; s++) {
      furball(s, f, false);
      furball(1000 + s, h, true);
      if (s <= Math.ceil(SEEDS / 3)) vic(2000 + s, v);
    }
    process.stdout.write(['', report('4v4 furball', f), report('4v4, allied leader flown without avoidance (human stand-in)', h), report('5-ship vic through turns', v), ''].join('\n'));
  }, 3_600_000);
});
