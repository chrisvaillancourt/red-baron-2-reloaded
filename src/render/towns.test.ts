import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gableRoof } from './towns';

describe('gableRoof', () => {
  it('faces every triangle outward, so the roof is visible from outside with front-face culling', () => {
    const pos = gableRoof().getAttribute('position');
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let t = 0; t < pos.count / 3; t++) {
      a.fromBufferAttribute(pos, t * 3);
      b.fromBufferAttribute(pos, t * 3 + 1);
      c.fromBufferAttribute(pos, t * 3 + 2);
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const centroid = a.clone().add(b).add(c).divideScalar(3);
      // Outward: away from the roof's interior axis (x = 0, y = 0.3), never down.
      const out = centroid.clone().sub(new Vector3(0, 0.3, centroid.z));
      if (Math.abs(n.z) > 0.9) out.set(0, 0, Math.sign(centroid.z));
      expect(n.dot(out), `triangle ${t}`).toBeGreaterThan(0);
      expect(n.y, `triangle ${t}`).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});
