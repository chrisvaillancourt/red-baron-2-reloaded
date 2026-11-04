// Whole-sector per-call cost of the world queries quoted in docs/world.md.
//   node tools/dev/differential-probe.mjs --baseline . --candidate . \
//     --scenario tools/dev/scenarios/world-bench.mjs --timeout-ms 240000
// Each side reports its own timings, so the probe exits 1 ("different") by design;
// read nsPerCall from both observations. Run on an idle machine.
// Points come from the same seeded LCG and bounds as world-equivalence.mjs and are
// precomputed so the generator isn't timed. Each query: warm-up, then the median of
// RUNS timed passes over all points.
export default async function ({ load, input }) {
  const terrain = await load('src/world/terrain.ts');
  const front = await load('src/world/frontline.ts');
  const date = input?.date ?? '1917-06-01';
  const n = input?.points ?? 200000;
  const RUNS = 3;
  front.craterGridsForDate(date);
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  let state = (input?.seed ?? 42) >>> 0;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    xs[i] = -65000 + (state / 4294967296) * 143000;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    zs[i] = -90000 + (state / 4294967296) * 168000;
  }
  const time = (fn) => {
    let acc = 0;
    for (let i = 0; i < Math.min(n, 20000); i++) acc += fn(xs[i], zs[i]);
    const runs = [];
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) acc += fn(xs[i], zs[i]);
      runs.push(((performance.now() - t0) * 1e6) / n);
    }
    runs.sort((a, b) => a - b);
    return { nsPerCall: Math.round(runs[RUNS >> 1]), finite: Number.isFinite(acc) };
  };
  return {
    node: process.version,
    points: n,
    height: time((x, z) => terrain.terrainHeightAt(x, z)),
    coast: time((x, z) => terrain.coastDistance(x, z)),
    signedFront: time((x, z) => front.signedDistanceToFront(x, z, date)),
    side: time((x, z) => (front.sideOfFrontAt(x, z, date) === 'allied' ? 1 : 0)),
  };
}
