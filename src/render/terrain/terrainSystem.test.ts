/**
 * Quadtree LOD selection, stand-in and eviction. Vitest runs in node, where
 * Worker is undefined, so chunks build on the main-thread fallback (a time
 * budget per frame): loop until nothing is pending and never assert frame or
 * chunk counts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, type Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { TerrainSystem, type TerrainOptions } from './terrainSystem';

const OPTS: TerrainOptions = { maxLevel: 7, splitFactor: 1.1, maxCached: 200, workers: 0, farDistance: 20_000 };
const FRAME_CAP = 600;

interface Drawn {
  level: number;
  ix: number;
  iz: number;
  box: Box3;
}

function drawn(ts: TerrainSystem): Drawn[] {
  return (ts.group.children as Mesh[])
    .filter((m) => m.visible)
    .map((m) => {
      const [, l, x, z] = m.name.split(':').map(Number);
      const bb = m.geometry.boundingBox!;
      const box = new Box3().set(bb.min.clone().add(m.position), bb.max.clone().add(m.position));
      return { level: l, ix: x, iz: z, box };
    });
}

function isAncestor(a: Drawn, b: Drawn): boolean {
  if (a.level >= b.level) return false;
  const s = b.level - a.level;
  return b.ix >> s === a.ix && b.iz >> s === a.iz;
}

function moveTo(cam: PerspectiveCamera, x: number, z: number, y = 1500): void {
  cam.position.set(x, y, z);
  cam.updateMatrixWorld();
}

/** Update until nothing is pending (frame-capped), then a few frames for the parent swap. */
function settle(ts: TerrainSystem, cam: PerspectiveCamera): number {
  let f = 0;
  do {
    ts.update(cam);
    f++;
  } while ((ts.pendingCount > 0 || f < 3) && f < FRAME_CAP);
  for (let i = 0; i < 3; i++) ts.update(cam);
  return f;
}

/** Number of drawn chunks whose footprint contains (x, z). */
function coverAt(d: Drawn[], x: number, z: number): number {
  let n = 0;
  for (const c of d) if (x >= c.box.min.x && x < c.box.max.x && z >= c.box.min.z && z < c.box.max.z) n++;
  return n;
}

describe('TerrainSystem LOD', () => {
  // Settling at the finest level is the slow part (~150 chunks): do it once.
  const ts = new TerrainSystem(new MeshBasicMaterial(), '1917-04-01', OPTS);
  const cam = new PerspectiveCamera();
  let frames = 0;
  beforeAll(() => {
    moveTo(cam, 0, 0);
    frames = settle(ts, cam);
  }, 30_000);

  it('settles with the finest level drawn near the camera and no overlapping chunks', () => {
    expect(frames).toBeLessThan(FRAME_CAP);
    expect(ts.pendingCount).toBe(0);
    const d = drawn(ts);
    expect(d.length).toBe(ts.drawnCount);
    // cdb0275 regression: with the parent standing in, the fine subtree was
    // never requested, so the view "settled" at level 2 and whenReady() lied.
    const finest = d.filter((c) => c.level === OPTS.maxLevel);
    expect(finest.length).toBeGreaterThan(0);
    expect(finest.some((c) => coverAt([c], cam.position.x, cam.position.z) === 1)).toBe(true);
    for (const a of d) for (const b of d) expect(isAncestor(a, b)).toBe(false);
  });

  it('keeps the view covered by exactly one chunk while a parent stands in after a move', () => {
    moveTo(cam, 3000, 2500);
    let sawPending = false;
    for (let f = 0; f < 5; f++) {
      ts.update(cam);
      sawPending ||= ts.pendingCount > 0;
      const d = drawn(ts);
      for (let x = -8000; x <= 8000; x += 500)
        for (let z = -8000; z <= 8000; z += 500) expect(coverAt(d, cam.position.x + x, cam.position.z + z)).toBe(1);
    }
    // The move must actually leave work outstanding, or this checks nothing.
    expect(sawPending).toBe(true);
  });

  it('bounds the chunk cache over a long flight and still settles', { timeout: 30_000 }, () => {
    // Coarser and nearer than OPTS so the flight is cheap but still overflows the cache.
    const o: TerrainOptions = { ...OPTS, maxLevel: 5, farDistance: 12_000, maxCached: 16 };
    const t = new TerrainSystem(new MeshBasicMaterial(), '1917-04-01', o);
    const c = new PerspectiveCamera();
    // Only level > 2 chunks are evictable (the 16 level-2 roots always stay),
    // and eviction runs every 30 frames: allow one window of builds over the cap.
    const evictable = () => t.group.children.filter((m) => Number(m.name.split(':')[1]) > 2).length;
    const bound = o.maxCached + 30;
    let peak = 0;
    for (let x = 0; x <= 80_000; x += 4000) {
      moveTo(c, x, 0);
      for (let f = 0; f < 45; f++) {
        t.update(c);
        peak = Math.max(peak, evictable());
      }
    }
    settle(t, c);
    expect(t.pendingCount).toBe(0);
    expect(peak).toBeGreaterThan(o.maxCached); // the flight did overflow the cache
    expect(peak).toBeLessThanOrEqual(bound);
  });
});
