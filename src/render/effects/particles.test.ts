/**
 * ParticlePool kill (swap-remove) and back-to-front sorting, read through the
 * GPU attributes. Stays below capacity: above it, spawn picks a random slot.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { ParticlePool } from './particles';

const SHORT = 0.05;

/** Ten particles along +x; odd ones die after one 0.1 s update. Each row's
 * size, colour and stretch encode its x so a torn row is detectable. */
function spawnRow(p: ParticlePool): void {
  for (let i = 0; i < 10; i++) {
    const x = i * 10;
    p.spawn({ x, y: 0, z: 0, life: i % 2 ? SHORT : 10, size0: x + 1, size1: x + 1, color: [x / 100, 0.5, 0.5], stretch: x });
  }
}

function rows(p: ParticlePool): { x: number; size: number; r: number; stretch: number }[] {
  const g = p.mesh.geometry;
  const P = g.getAttribute('iPos').array as Float32Array;
  const C = g.getAttribute('iCol').array as Float32Array;
  const M = g.getAttribute('iMisc').array as Float32Array;
  return Array.from({ length: p.count }, (_, o) => ({ x: P[o * 4], size: P[o * 4 + 3], r: C[o * 4], stretch: M[o * 4 + 2] }));
}

describe('ParticlePool', () => {
  it('removes dead particles without tearing attribute rows', () => {
    const p = new ParticlePool(100, false);
    spawnRow(p);
    const cam = new PerspectiveCamera();
    p.update(0.1, new Vector3(), cam, false);
    expect(p.count).toBe(5);
    const r = rows(p);
    expect(r.map((o) => o.x).sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80]);
    for (const o of r) {
      expect(o.size).toBeCloseTo(o.x + 1, 4);
      expect(o.r).toBeCloseTo(o.x / 100, 5);
      expect(o.stretch).toBe(o.x);
    }
    expect((p.mesh.geometry as unknown as { instanceCount: number }).instanceCount).toBe(5);
  });

  it('orders survivors back to front from the camera when sorting', () => {
    const p = new ParticlePool(100, false);
    spawnRow(p);
    const cam = new PerspectiveCamera();
    cam.position.set(-100, 0, 0);
    p.update(0.1, new Vector3(), cam, true);
    const d = rows(p).map((o) => Math.abs(o.x - cam.position.x));
    expect(d.length).toBe(5);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThanOrEqual(d[i - 1]);
  });
});
