// Leaf-module smoke for the same Vite SSR loading path used by world/sim graphs.
export default async function ({ load }) {
  const geo = await load('src/core/geo.ts');
  return [[50.851, 2.885], [49.894, 2.3], [50.372, 2.78]].map(([lat, lon]) => {
    const position = geo.latLonToWorld(lat, lon);
    return { lat, lon, ...position, roundTrip: geo.worldToLatLon(position.x, position.z) };
  });
}
