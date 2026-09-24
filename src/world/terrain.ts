/**
 * Terrain height field. STUB authored by the lead (gentle rolling plain);
 * the world agent replaces the implementation but must keep the exported
 * signature. Pure function of (x, z): no scene code, safe in Node tests.
 */
export function terrainHeightAt(x: number, z: number): number {
  return 40 + 25 * Math.sin(x * 0.00021) * Math.cos(z * 0.00017) + 10 * Math.sin((x + z) * 0.0009);
}
