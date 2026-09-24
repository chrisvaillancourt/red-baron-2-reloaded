import { describe, expect, it } from 'vitest';
import { roadNetwork } from '../world/roads';
import { daylightHours, hourForTimeOfDay, sunPosition } from './environment';
import { buildChunk, buildChunkIndices, vertexCount } from './terrain/chunkBuilder';

describe('sun', () => {
  it('stands high in the south at midsummer noon and low at dawn', () => {
    const noon = sunPosition('1917-06-21', 12);
    expect(noon.elevationDeg).toBeGreaterThan(60);
    expect(noon.elevationDeg).toBeLessThan(66);
    expect(Math.abs(noon.azimuthDeg - 180)).toBeLessThan(2);
    const dawn = sunPosition('1917-06-21', hourForTimeOfDay('1917-06-21', 'dawn'));
    expect(dawn.elevationDeg).toBeGreaterThan(0);
    expect(dawn.elevationDeg).toBeLessThan(8);
    expect(dawn.direction[0]).toBeGreaterThan(0); // east
  });
  it('has short winter days', () => {
    const w = daylightHours('1916-12-21');
    expect(w.sunset - w.sunrise).toBeLessThan(8.5);
  });
});

describe('terrain chunks', () => {
  it('builds a consistent grid with skirts', () => {
    const d = buildChunk({ id: 1, cx: 0, cz: 0, size: 512, date: '1917-06-01' });
    expect(d.positions.length).toBe(vertexCount() * 3);
    expect(d.land.length).toBe(vertexCount() * 4);
    const idx = buildChunkIndices();
    expect(Math.max(...idx)).toBeLessThan(vertexCount());
    expect(d.maxY).toBeGreaterThan(d.minY);
  });
});

describe('roads', () => {
  it('links the towns', () => {
    const r = roadNetwork();
    expect(r.length).toBeGreaterThan(100);
    expect(r.some((x) => (x.from === 'Arras' && x.to === 'Douai') || (x.from === 'Douai' && x.to === 'Arras'))).toBe(true);
  });
});
