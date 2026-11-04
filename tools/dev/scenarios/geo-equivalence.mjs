// Leaf-module smoke for the same Vite SSR loading path used by world/sim graphs.
// Coverage: every point makes a finite world position and lat/lon round trip.
import { requireCoverage } from './coverage.mjs';

export default async function ({ load }) {
  const geo = await load('src/core/geo.ts');
  const points = [[50.851, 2.885], [49.894, 2.3], [50.372, 2.78]].map(([lat, lon]) => {
    const position = geo.latLonToWorld(lat, lon);
    return { lat, lon, ...position, roundTrip: geo.worldToLatLon(position.x, position.z) };
  });
  const finite = points.filter((p) => [p.x, p.z, p.roundTrip?.lat, p.roundTrip?.lon].every(Number.isFinite)).length;
  // The three fixed inputs, not a sim figure: fewer means the leaf path broke.
  return { points, tally: requireCoverage('geo-equivalence', { geo: { counts: { 'round-trips': finite }, minimums: { 'round-trips': 3 } } }) };
}
