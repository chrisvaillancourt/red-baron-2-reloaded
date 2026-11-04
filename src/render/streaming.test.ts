/**
 * Tree-cell and town-tile streaming around the camera. Vitest runs in node,
 * where Worker is undefined, so both layers build on their main-thread
 * fallbacks (time- or count-budgeted per frame): loop until nothing is
 * pending and assert invariants, not counts.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { QUALITY } from './quality';
import { TownLayer } from './towns';
import { TreeLayer } from './trees';

const FRAME_CAP = 400;

function settle(layer: { update(cam: Vector3): void; pendingCount: number }, cam: Vector3): number {
  let f = 0;
  do {
    layer.update(cam);
    f++;
  } while (layer.pendingCount > 0 && f < FRAME_CAP);
  return f;
}

describe('TreeLayer streaming', () => {
  it('builds the cells around the camera and draws trees', () => {
    const tr = new TreeLayer('1917-06-01', { ...QUALITY.low });
    const cam = new Vector3(0, 300, 0);
    expect(settle(tr, cam)).toBeLessThan(FRAME_CAP);
    expect(tr.pendingCount).toBe(0);
    // Repack is throttled by distance moved; nudge past it so every built cell is packed.
    cam.x += 150;
    settle(tr, cam);
    expect(tr.instanceCount).toBeGreaterThan(0);
  });

  it('evicts far cells over a long flight', { timeout: 30_000 }, () => {
    // Sparse, wide trees: many cheap cells per position so the cache fills fast.
    const q = { ...QUALITY.low, treeDensity: 0.05, treeRadius: 4000 };
    const tr = new TreeLayer('1917-06-01', q);
    const cam = new Vector3();
    let peak = 0;
    for (let x = 0; x <= 120_000; x += 4000) {
      cam.set(x, 300, 0);
      settle(tr, cam);
      expect(tr.pendingCount).toBe(0);
      peak = Math.max(peak, tr.takePerf().cells);
    }
    // TreeLayer keeps at most 1200 cells once it starts evicting.
    expect(peak).toBeLessThanOrEqual(1200);
    expect(peak).toBeGreaterThan(600); // the path did fill the cache
  });
});

describe('TownLayer streaming', () => {
  it('builds tiles in range and hides them once the camera leaves', () => {
    const q = { ...QUALITY.low };
    const tw = new TownLayer('1917-06-01', q);
    const cam = new Vector3(0, 300, 0);
    expect(settle(tw, cam)).toBeLessThan(FRAME_CAP);
    expect(tw.pendingCount).toBe(0);
    const near = tw.group.children.filter((g) => g.visible);
    expect(near.length).toBeGreaterThan(0);
    cam.set(q.buildingDistance * 5, 300, 0);
    tw.update(cam);
    for (const g of near) expect(g.visible).toBe(false);
  });
});
