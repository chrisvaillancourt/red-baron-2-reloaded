import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Weather } from '../core/types';
import { CLOUD_CELL, CloudField, cloudDrift } from '../world/clouds';
import { CloudShadows } from './cloudShadows';

const weather = (cloudCover: number, wind: [number, number, number] = [0, 0, 0]): Weather => ({
  cloudCover,
  cloudBaseM: 1500,
  cloudTopM: 2300,
  wind,
  visibilityM: 30_000,
  turbulence: 0.2,
});

/** The first body with any size near the origin, and where its centre shadow falls at noon. */
function firstBody(w: Weather) {
  const f = new CloudField(w);
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const b = f.bodiesInCell(i, j)[0];
      if (b) return b;
    }
  throw new Error('no cloud bodies near the origin');
}

describe('CloudShadows', () => {
  it('casts nothing on a clear day or under a full overcast', () => {
    const s = new CloudShadows();
    s.setWeather(weather(0), new Vector3(0, 1, 0), 0);
    s.update(new Vector3(), 0);
    expect(s.uniforms.uCloudShadowK.value).toBe(0);
    s.setWeather(weather(0.95), new Vector3(0, 1, 0), 1);
    s.update(new Vector3(), 0);
    expect(s.uniforms.uCloudShadowK.value).toBe(0);
  });

  it('shades the ground under a cloud with the sun overhead, and not open ground far from it', () => {
    const w = weather(0.5);
    const b = firstBody(w);
    const s = new CloudShadows();
    s.setWeather(w, new Vector3(0, 1, 0), 0);
    s.update(new Vector3(b.cx, 500, b.cz), 0);
    expect(s.sample(b.cx, b.cz, 0)).toBeGreaterThan(0.3);
    // Somewhere in the covered square that no body reaches (lobes stay within ~1.3 radii).
    const f = new CloudField(w);
    const near = [-3, -2, -1, 0, 1, 2, 3].flatMap((i) =>
      [-3, -2, -1, 0, 1, 2, 3].flatMap((j) => f.bodiesInCell(Math.floor(b.cx / CLOUD_CELL) + i, Math.floor(b.cz / CLOUD_CELL) + j)),
    );
    let clear: [number, number] | null = null;
    for (let dx = -9000; dx <= 9000 && !clear; dx += 500)
      for (let dz = -9000; dz <= 9000 && !clear; dz += 500)
        if (near.every((o) => Math.hypot(o.cx - (b.cx + dx), o.cz - (b.cz + dz)) > 1.6 * Math.max(o.rx, o.rz))) clear = [b.cx + dx, b.cz + dz];
    expect(clear).not.toBeNull();
    expect(s.sample(clear![0], clear![1], 0)).toBe(0);
  });

  it('throws the shadow away from a low sun by the cloud height', () => {
    const w = weather(0.5);
    const b = firstBody(w);
    const sun = new Vector3(1, 0.5, 0).normalize();
    const s = new CloudShadows();
    s.setWeather(w, sun, 0);
    s.update(new Vector3(b.cx, 500, b.cz), 0);
    const shift = (-sun.x / sun.y) * ((b.base + b.top) / 2);
    expect(s.sample(b.cx + shift, b.cz, 0)).toBeGreaterThan(s.sample(b.cx - shift, b.cz, 0));
  });

  it('moves the shadows with the wind without rebuilding the texture', () => {
    const w = weather(0.5, [8, 0, 0]);
    const b = firstBody(w);
    const s = new CloudShadows();
    s.setWeather(w, new Vector3(0, 1, 0), 0);
    s.update(new Vector3(b.cx, 500, b.cz), 0);
    const before = s.builds;
    const t = 60;
    const d = cloudDrift(w, t);
    s.update(new Vector3(b.cx, 500, b.cz), t);
    expect(s.builds).toBe(before);
    expect(s.sample(b.cx + d.x, b.cz + d.z, t)).toBeCloseTo(s.sample(b.cx, b.cz, 0), 5);
  });

  it('rebuilds only after the camera travels a few kilometres', () => {
    const s = new CloudShadows();
    s.setWeather(weather(0.5), new Vector3(0, 1, 0), 0);
    s.update(new Vector3(0, 500, 0), 0);
    const n = s.builds;
    s.update(new Vector3(1000, 500, 0), 0);
    expect(s.builds).toBe(n);
    s.update(new Vector3(8000, 500, 0), 0);
    expect(s.builds).toBe(n + 1);
  });
});
