import { describe, expect, it } from 'vitest';
import { QUICK_COLLISION_CASES, runQuickCollisionCase } from './testing/quickCollisionScenarios';

describe('collision avoidance in reproduced quick-mission approaches', () => {
  for (const scenario of QUICK_COLLISION_CASES) {
    it(`keeps clear of ${scenario.name} without abandoning combat`, () => {
      const report = runQuickCollisionCase(scenario);
      // The real SimCore/combat event path reported collisions on the frozen base.
      // Assert the behavior, not incidental collision times, angles or AI state strings.
      expect(report.collisions).toEqual([]);
      expect(report.events['collision'] ?? 0).toBe(0);
      expect(report.firstContact).not.toBeNull();
      expect(report.events['gun-fired'] ?? 0).toBeGreaterThan(0);
      expect(report.badSpawns).toEqual([]);
    }, 30_000);
  }
});
