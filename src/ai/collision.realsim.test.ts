import { describe, expect, it } from 'vitest';
import { furball, tally } from './testing/collisionScenarios';

/**
 * 4v4 head-on furballs where the allied leader has no collision avoidance of its own - the
 * human player's situation: he won't dodge for the AI. Before the early head-on break and
 * the wider berth for the player, ~18% of these fights ended with the leader rammed.
 */
describe('mid-air collisions with a pilot who does not dodge', () => {
  it('the AI keeps clear of him in a furball without going timid', () => {
    const t = tally();
    for (let s = 1; s <= 20; s++) furball(1000 + s, t, true);
    const human = [...t.collisions].filter(([k]) => k.startsWith('human-')).reduce((n, [, v]) => n + v, 0);
    expect(human).toBeLessThanOrEqual(1);
    // Still a fight: at least two kills a run on average.
    expect(t.kills / t.runs).toBeGreaterThan(2);
  }, 60_000);
});
