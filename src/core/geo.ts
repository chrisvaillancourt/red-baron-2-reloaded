/**
 * Map projection for the Western Front sector (DECISIONS.md D-005).
 *
 * Equirectangular projection around an origin near Arras. 1 world unit = 1 m.
 * +X east, -Z north. Good to well under 1% over the ~150 km sector.
 */
export const GEO_ORIGIN = { lat: 50.3, lon: 2.8 } as const;
const M_PER_DEG_LAT = 111_200;
const M_PER_DEG_LON = 111_320 * Math.cos((GEO_ORIGIN.lat * Math.PI) / 180);

/** Playable sector bounds in world metres. Outside this the terrain fades to haze. */
export const SECTOR_BOUNDS = {
  minX: -65_000, // ~1.9°E  (Channel coast side)
  maxX: 78_000, // ~3.9°E
  minZ: -90_000, // ~51.1°N (north: Flanders coast)
  maxZ: 78_000, // ~49.6°N (south: below the Somme)
} as const;

export function latLonToWorld(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - GEO_ORIGIN.lon) * M_PER_DEG_LON,
    z: -(lat - GEO_ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

export function worldToLatLon(x: number, z: number): { lat: number; lon: number } {
  return {
    lat: GEO_ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: GEO_ORIGIN.lon + x / M_PER_DEG_LON,
  };
}

/** Heading in radians (0 = north, clockwise) from a world-frame direction. */
export function headingFromVector(dx: number, dz: number): number {
  const h = Math.atan2(dx, -dz);
  return h < 0 ? h + Math.PI * 2 : h;
}
