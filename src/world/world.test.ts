import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../core/geo';
import { AERODROMES } from '../data/aerodromes';
import { craterGridsForDate, craterIntensityAt, frontLineAt, hasCraterGrids, installCraterGrids, sideOfFrontAt, signedDistanceToFront } from './frontline';
import { landUseAt } from './landuse';
import { coastDistance, terrainHeightAt } from './terrain';

const at = (lat: number, lon: number) => latLonToWorld(lat, lon);
const h = (lat: number, lon: number) => {
  const p = at(lat, lon);
  return terrainHeightAt(p.x, p.z);
};
const side = (lat: number, lon: number, date: string) => {
  const p = at(lat, lon);
  return sideOfFrontAt(p.x, p.z, date);
};

describe('terrain', () => {
  it('is deterministic', () => {
    expect(terrainHeightAt(1234.5, -9876.5)).toBe(terrainHeightAt(1234.5, -9876.5));
  });
  it('matches regional relief', () => {
    expect(h(51.035, 2.6)).toBeLessThan(15); // coastal polders near Dunkirk
    expect(h(50.851, 2.885)).toBeLessThan(45); // Ypres on the Flanders plain
    expect(h(50.782, 2.812)).toBeGreaterThan(120); // Mont Kemmel
    expect(h(50.8, 2.487)).toBeGreaterThan(140); // Mont Cassel
    expect(h(50.372, 2.78)).toBeGreaterThan(100); // Vimy ridge crest
    expect(h(50.43, 2.95)).toBeLessThan(60); // Douai plain
    expect(h(50.07, 2.75)).toBeGreaterThan(70); // Somme uplands (Pozières)
    expect(h(50.07, 2.75)).toBeLessThan(170);
  });
  it('carves river valleys below the plateau', () => {
    const amiens = h(49.894, 2.3);
    expect(amiens).toBeLessThan(40);
    const plateau = h(49.97, 2.45);
    expect(plateau - h(49.905, 2.52)).toBeGreaterThan(20);
  });
  it('has sea west of the coast', () => {
    const channel = at(50.9, 1.4);
    expect(coastDistance(channel.x, channel.z)).toBeLessThan(0);
    expect(terrainHeightAt(channel.x, channel.z)).toBeLessThan(0);
    const inland = at(50.5, 2.5);
    expect(coastDistance(inland.x, inland.z)).toBeGreaterThan(0);
  });
  it('flattens aerodromes', () => {
    for (const a of AERODROMES) {
      const c = terrainHeightAt(a.x, a.z);
      for (const [dx, dz] of [[300, 0], [-300, 0], [0, 300], [0, -300], [200, 200]]) {
        expect(Math.abs(terrainHeightAt(a.x + dx, a.z + dz) - c)).toBeLessThan(0.05);
      }
    }
  });
  it('is fast enough for mesh generation', () => {
    for (let i = 0; i < 2000; i++) terrainHeightAt(i * 13, -i * 7); // JIT warm-up
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 20000; i++) s += terrainHeightAt((i % 141) * 37 - 2000, Math.floor(i / 141) * 41 - 30000);
    const dt = performance.now() - t0;
    expect(s).not.toBeNaN();
    expect(dt / 20000).toBeLessThan(0.06); // < 60 µs per call; generous so parallel test load doesn't flake it
  });
});

describe('front lines', () => {
  it('Amiens is always allied, Cambrai central through 1917', () => {
    for (const d of ['1915-07-01', '1916-09-01', '1917-06-01', '1918-04-10', '1918-08-01', '1918-10-10']) {
      expect(side(49.894, 2.296, d)).toBe('allied');
    }
    for (const d of ['1915-08-01', '1916-08-01', '1917-01-01', '1917-11-25', '1917-12-31']) {
      expect(side(50.176, 3.235, d)).toBe('central');
    }
  });
  it('Lille is central until October 1918', () => {
    for (const d of ['1915-07-01', '1916-07-01', '1917-07-01', '1918-06-01', '1918-10-01']) expect(side(50.629, 3.057, d)).toBe('central');
    expect(side(50.629, 3.057, '1918-10-25')).toBe('allied');
  });
  it('Vimy falls in April 1917', () => {
    expect(side(50.372, 2.811, '1916-06-01')).toBe('central');
    expect(side(50.372, 2.811, '1917-04-08')).toBe('central');
    expect(side(50.372, 2.811, '1917-04-20')).toBe('allied');
  });
  it('tracks the Somme, Hindenburg Line, Michael and the Lys', () => {
    expect(side(50.054, 2.686, '1916-06-01')).toBe('central'); // Thiepval before the Somme
    expect(side(50.054, 2.686, '1916-12-01')).toBe('allied');
    expect(side(50.103, 2.85, '1916-12-01')).toBe('central'); // Bapaume
    expect(side(50.103, 2.85, '1917-05-01')).toBe('allied'); // after the withdrawal
    expect(side(50.001, 2.652, '1918-04-20')).toBe('central'); // Albert taken in Michael
    expect(side(49.868, 2.519, '1918-04-20')).toBe('allied'); // Villers-Bretonneux held
    expect(side(50.739, 2.735, '1918-05-10')).toBe('central'); // Bailleul after the Lys
    expect(side(50.851, 2.885, '1918-05-10')).toBe('allied'); // Ypres never fell
    expect(side(50.9, 3.02, '1917-12-01')).toBe('allied'); // Passchendaele
    expect(side(50.9, 3.02, '1917-06-01')).toBe('central');
  });
  it('holds quiet sectors still while another moves', () => {
    const p = at(50.85, 2.95);
    const a = signedDistanceToFront(p.x, p.z, '1916-07-01');
    const b = signedDistanceToFront(p.x, p.z, '1916-09-15');
    expect(Math.abs(a - b)).toBeLessThan(30);
  });
  it('has a polyline spanning the sector north to south', () => {
    const pts = frontLineAt('1917-06-01').points;
    expect(pts[0].z).toBeLessThan(-90_000);
    expect(pts[pts.length - 1].z).toBeGreaterThan(78_000);
  });
  it('is fast per call', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) sideOfFrontAt((i % 200) * 500 - 50000, Math.floor(i / 200) * 1500 - 80000, '1917-06-01');
    expect((performance.now() - t0) / 20000).toBeLessThan(0.02);
  });
});

describe('land use', () => {
  it('classifies known places', () => {
    const channel = at(50.9, 1.4);
    expect(landUseAt(channel.x, channel.z, '1917-01-01')).toBe('sea');
    const lille = at(50.629, 3.057);
    expect(landUseAt(lille.x, lille.z, '1917-01-01')).toBe('town');
    const somme = at(50.03, 2.72);
    expect(['trench-zone', 'shell-cratered']).toContain(landUseAt(somme.x, somme.z, '1916-10-01'));
    const rear = at(50.2, 2.1);
    expect(craterIntensityAt(rear.x, rear.z, '1918-01-01')).toBe(0);
  });
});

describe('crater grid handoff (worker -> main thread)', () => {
  it('installed grids are used without rebuilding', () => {
    const date = '1916-02-03';
    expect(hasCraterGrids(date)).toBe(false);
    const g = craterGridsForDate('1916-02-04')!;
    // A marked copy proves queries read the installed arrays.
    installCraterGrids(date, g[0].map(() => 0.42), g[1].slice());
    expect(hasCraterGrids(date)).toBe(true);
    const p = at(50.29, 2.8);
    expect(craterIntensityAt(p.x, p.z, date)).toBeCloseTo(0.42, 5);
    expect(hasCraterGrids('1914-01-01')).toBe(true); // pre-war: nothing to build
  });
});
