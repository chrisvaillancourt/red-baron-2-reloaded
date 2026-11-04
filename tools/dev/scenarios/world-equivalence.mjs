// One scenario file runs unchanged against both complete extensionless TS graphs.
// Import order and lazy setup are intentional: river/aerodrome levels, front-line
// crater grids and roads must see the same history before any observations.
// Coverage (F-115): crater grids for every date, the road network, and observations near
// rivers and the coast, on fresh battlefield, on cratered or trench ground and in towns.
import { requireCoverage } from './coverage.mjs';

export default async function ({ load, input }) {
  const geo = await load('src/core/geo.ts');
  const terrain = await load('src/world/terrain.ts');
  const front = await load('src/world/frontline.ts');
  const land = await load('src/world/landuse.ts');
  const roads = await load('src/world/roads.ts');
  const { AERODROMES } = await load('src/data/aerodromes.ts');
  const dates = ['1916-09-01', '1917-06-01', '1918-04-10'];
  const points = [
    ...[[50.851, 2.885], [50.372, 2.78], [49.894, 2.3], [50.9, 1.4], [50.629, 3.057]].map(([lat, lon]) => geo.latLonToWorld(lat, lon)),
    ...AERODROMES.map(({ x, z }) => ({ x, z })),
  ];
  let state = (input?.seed ?? 42) >>> 0;
  for (let i = 0; i < 48; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = -65000 + (state / 4294967296) * 143000;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    points.push({ x, z: -90000 + (state / 4294967296) * 168000 });
  }
  const cold = dates.map((date) => front.hasCraterGrids(date));
  terrain.riverPolylines();
  roads.roadNetwork();
  for (const date of dates) {
    front.craterGridsForDate(date);
    for (const { x, z } of points) {
      terrain.terrainHeightAt(x, z);
      land.landWeights(x, z, date);
      land.landUseAt(x, z, date);
    }
  }
  const observations = [];
  for (const date of dates) {
    for (const { x, z } of points) {
      // Materialize each observation before the next call can reuse any scratch.
      const weights = { ...land.landWeights(x, z, date) };
      const river = terrain.riverQuery(x, z, Infinity);
      observations.push({
        date, x, z, weights,
        surface: land.landUseAt(x, z, date),
        coast: terrain.coastDistance(x, z),
        freshness: front.battleFreshnessAt(x, z, date),
        river: { name: river.river?.name ?? null, distance: river.distance, floor: river.floor },
      });
    }
  }
  const network = roads.roadNetwork();
  const warm = dates.map((date) => front.hasCraterGrids(date));
  const roadSummary = { count: network.length, points: network.reduce((n, road) => n + road.points.length, 0) };
  const where = (test) => observations.filter(test).length;
  const counts = {
    'crater-grid-dates': warm.filter(Boolean).length,
    roads: roadSummary.count,
    'road-points': roadSummary.points,
    'near-river': where((o) => o.river.distance < 2000),
    'near-coast': where((o) => o.coast < 5000),
    'fresh-battlefield': where((o) => o.freshness > 0),
    'cratered-or-trench': where((o) => o.surface === 'shell-cratered' || o.surface === 'trench-zone'),
    town: where((o) => o.surface === 'town'),
  };
  // Seed 42 gives 3 dates, 225 roads (2436 points), 42 near rivers, 9 near the coast,
  // 32 fresh, 21 cratered or trench and 15 town (2026-11-04). Dates are the input count.
  const minimums = {
    'crater-grid-dates': dates.length, roads: 50, 'road-points': 500, 'near-river': 10,
    'near-coast': 2, 'fresh-battlefield': 8, 'cratered-or-trench': 5, town: 3,
  };
  return {
    setup: { cold, warm },
    roads: roadSummary,
    observations,
    tally: requireCoverage('world-equivalence', { world: { counts, minimums } }),
  };
}
