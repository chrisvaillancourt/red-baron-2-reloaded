/**
 * Whole-mission replays of the three Q-05 collision approaches (AI_SOAK=quickcollision):
 *   AI_SOAK=quickcollision pnpm exec vitest run src/ai/quickCollision.soak.test.ts
 *
 * Opt-in, not CI (D-118). Each case flies a real quick mission for 215–660 s. The sim is
 * deterministic on one platform only: V8 and libm results differ in the last bit across Node
 * releases, OS and CPU, and a one-ulp difference grows to a different fight within about four
 * minutes. Seed 1495 collides at t=443 on Linux x64, at t=449 on macOS x64 and not at all on
 * macOS arm64 with the same commit and Node 26.12.1. These replays therefore no longer reach
 * their recorded approach anywhere, and a zero-collision assertion over them depends on the
 * machine. CI covers the same geometry with short, platform-stable encounters instead:
 * `extendCollision.test.ts`, `extendCollision.realsim.test.ts` and `collision.realsim.test.ts`.
 * Run this soak on one machine to compare two commits, as with the other soaks.
 */
import { describe, expect, it } from 'vitest';
import { QUICK_COLLISION_CASES, runQuickCollisionCase } from './testing/quickCollisionScenarios';

const SOAK = (process.env.AI_SOAK ?? '').split(',');

describe.skipIf(!SOAK.includes('quickcollision'))('soak: reproduced quick-mission collision approaches', () => {
  for (const scenario of QUICK_COLLISION_CASES) {
    it(`keeps clear of ${scenario.name} without abandoning combat`, () => {
      const report = runQuickCollisionCase(scenario);
      process.stdout.write(`${scenario.name}: collisions ${JSON.stringify(report.collisions)}\n`);
      expect(report.collisions).toEqual([]);
      expect(report.events['collision'] ?? 0).toBe(0);
      expect(report.firstContact).not.toBeNull();
      expect(report.events['gun-fired'] ?? 0).toBeGreaterThan(0);
      expect(report.badSpawns).toEqual([]);
    }, 30_000);
  }
});
