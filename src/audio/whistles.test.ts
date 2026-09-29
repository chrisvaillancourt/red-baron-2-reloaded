import { describe, expect, it } from 'vitest';
import { BOMB_WHISTLE_SECONDS } from './synthBuffers';
import { MAX_WHISTLES, WhistleQueue, whistleStart } from './whistles';

describe('bomb whistle timing', () => {
  it('ends the whistle at the impact, whatever its playback rate', () => {
    for (const rate of [0.94, 1, 1.06]) {
      const start = whistleStart(10, 12, rate)!;
      // Played from `start` at `rate`, the clip lasts BOMB_WHISTLE_SECONDS / rate.
      expect(start + BOMB_WHISTLE_SECONDS / rate).toBeCloseTo(22, 9);
    }
  });

  it('skips a fall too short for most of the whistle', () => {
    expect(whistleStart(0, BOMB_WHISTLE_SECONDS * 0.5, 1)).toBeNull();
  });
});

describe('WhistleQueue', () => {
  it('holds a whistle until just before it starts', () => {
    const q = new WhistleQueue();
    q.add({ start: 20, rate: 1, distance: 300 });
    expect(q.due(10)).toEqual([]);
    expect(q.due(19.95)).toHaveLength(1);
    expect(q.due(19.96)).toEqual([]);
  });

  it(`plays at most ${MAX_WHISTLES} at once, nearest first`, () => {
    const q = new WhistleQueue();
    for (let i = 0; i < 6; i++) q.add({ start: 5, rate: 1, distance: 600 - i * 100 });
    const played = q.due(5);
    expect(played.map((w) => w.distance)).toEqual([100, 200, 300]);
    // The rest were due with no free slot: dropped, not held back to play late.
    expect(q.pending).toBe(0);
    // Slots free up as the playing whistles end.
    q.add({ start: 5 + BOMB_WHISTLE_SECONDS + 0.1, rate: 1, distance: 50 });
    expect(q.due(5 + BOMB_WHISTLE_SECONDS + 0.1)).toHaveLength(1);
  });

  it('drops a whistle whose start has already passed', () => {
    const q = new WhistleQueue();
    q.add({ start: 5, rate: 1, distance: 100 });
    expect(q.due(6)).toEqual([]);
    expect(q.pending).toBe(0);
  });
});
