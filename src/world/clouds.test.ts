import { describe, expect, it } from 'vitest';
import type { Weather } from '../core/types';
import { CLOUD_CELL, CloudField, cloudBodiesInCell } from './clouds';
import { sunDirectionFor } from './sun';

const CUMULUS: Weather = { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 2300, wind: [4, 0, -2], visibilityM: 25_000, turbulence: 0.2 };

/** The first cloud body found near the origin, and its world centre at time t. */
function someCloud(f: CloudField, t: number) {
  for (let ix = -3; ix <= 3; ix++)
    for (let iz = -3; iz <= 3; iz++) {
      const b = f.bodiesInCell(ix, iz)[0];
      if (b && b.top - b.base > 300) return { b, x: b.cx + CUMULUS.wind[0] * t, y: (b.base + b.top) / 2, z: b.cz + CUMULUS.wind[2] * t };
    }
  throw new Error('no cloud');
}

describe('cloud field', () => {
  it('is deterministic per cell and empty in clear skies', () => {
    expect(cloudBodiesInCell(CUMULUS, 3, -2)).toEqual(cloudBodiesInCell(CUMULUS, 3, -2));
    expect(cloudBodiesInCell({ ...CUMULUS, cloudCover: 0 }, 3, -2)).toEqual([]);
    const f = new CloudField({ ...CUMULUS, cloudCover: 0 });
    expect(f.densityAt(0, 1800, 0, 0)).toBe(0);
    expect(f.transmittance(0, 1000, 0, 5000, 2500, 0, 0)).toBe(1);
  });

  it('puts a cloud where the wind has drifted it', () => {
    const f = new CloudField(CUMULUS);
    const t0 = someCloud(f, 0);
    expect(f.densityAt(t0.x, t0.y, t0.z, 0)).toBeGreaterThan(0.5);
    const t = 600; // 10 min: 2.4 km east, 1.2 km north
    const c = someCloud(f, t);
    expect(f.densityAt(c.x, c.y, c.z, t)).toBeGreaterThan(0.5);
    expect(c.x - t0.x).toBeCloseTo(2400);
    // Nothing is left at the old spot unless another cloud drifted in.
    expect(f.densityAt(t0.x, t0.y, t0.z, t)).toBeLessThan(f.densityAt(c.x, c.y, c.z, t));
  });

  it('blocks a line of sight through a cloud core, not one below the base', () => {
    const f = new CloudField(CUMULUS);
    const c = someCloud(f, 0);
    const through = f.transmittance(c.x - 2 * c.b.rx, c.y, c.z, c.x + 2 * c.b.rx, c.y, c.z, 0);
    expect(through).toBeLessThan(0.05);
    const below = f.transmittance(c.x - 2000, 800, c.z, c.x + 2000, 900, c.z, 0);
    expect(below).toBe(1);
    // Looking up into the cloud from beneath it passes through part of it.
    const up = f.transmittance(c.x, 800, c.z, c.x, c.y, c.z, 0);
    expect(up).toBeLessThan(1);
    expect(up).toBeGreaterThan(through);
  });

  it('finds the nearest cloud to hide in, where the wind has taken it', () => {
    const f = new CloudField(CUMULUS);
    const t = 300;
    const c = f.nearestCloud(0, 1200, 0, t, 8000);
    expect(c).not.toBeNull();
    expect(Math.hypot(c!.x, c!.z)).toBeLessThanOrEqual(8000);
    expect(f.densityAt(c!.x, c!.y, c!.z, t)).toBeGreaterThan(0.5);
    expect(new CloudField({ ...CUMULUS, cloudCover: 0 }).nearestCloud(0, 1200, 0, t, 8000)).toBeNull();
  });

  it('treats an overcast deck as solid inside its core band', () => {
    const f = new CloudField({ ...CUMULUS, cloudCover: 0.95 });
    expect(f.densityAt(12_345, 1700, -777, 0)).toBe(1);
    expect(f.transmittance(0, 1000, 0, 0, 2600, 0, 0)).toBeLessThan(0.05);
  });

  it('cell size matches the renderer grid', () => {
    expect(CLOUD_CELL).toBe(3000);
  });
});

describe('sun direction', () => {
  it('is up at midday and low in the east at dawn in summer', () => {
    const noon = sunDirectionFor('1917-06-21', 'midday');
    expect(noon.length()).toBeCloseTo(1);
    expect(noon.y).toBeGreaterThan(0.85);
    const dawn = sunDirectionFor('1917-06-21', 'dawn');
    expect(dawn.y).toBeGreaterThan(0);
    expect(dawn.y).toBeLessThan(0.15);
    expect(dawn.x).toBeGreaterThan(0.5); // +X is east
  });
});
