/**
 * Historical aerodromes in the Flanders–Artois–Somme sector (approximate
 * positions). Shared by src/world (rendering hangars/fields), src/campaign
 * (squadron bases, mission start/finish) and src/game (landing detection).
 *
 * `activeFrom`/`activeTo` bound when the field was in use by `side`. A field
 * outside its window is rendered as farmland. Ahistorical placements made for
 * gameplay are marked `rebased: true` (DECISIONS.md D-006).
 */
import { latLonToWorld } from '../core/geo';
import type { Side } from '../core/types';

export interface Aerodrome {
  id: string;
  name: string;
  lat: number;
  lon: number;
  side: Side;
  activeFrom: string;
  activeTo: string;
  /** Runway (grass strip) heading in degrees true; fields were grass, into prevailing westerlies. */
  runwayHeadingDeg: number;
  /** Strip length, metres. */
  runwayLength: number;
  rebased?: boolean;
}

const RAW: Aerodrome[] = [
  // --- German Empire ----------------------------------------------------
  { id: 'douai', name: 'Douai', lat: 50.372, lon: 3.083, side: 'central', activeFrom: '1915-01-01', activeTo: '1918-10-15', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'la-brayelle', name: 'La Brayelle (Douai)', lat: 50.382, lon: 3.052, side: 'central', activeFrom: '1916-10-01', activeTo: '1918-10-15', runwayHeadingDeg: 260, runwayLength: 650 },
  { id: 'roucourt', name: 'Roucourt', lat: 50.332, lon: 3.162, side: 'central', activeFrom: '1917-04-01', activeTo: '1918-10-15', runwayHeadingDeg: 250, runwayLength: 600 },
  { id: 'bertincourt', name: 'Bertincourt', lat: 50.083, lon: 2.982, side: 'central', activeFrom: '1916-08-01', activeTo: '1917-03-10', runwayHeadingDeg: 260, runwayLength: 600 },
  { id: 'lagnicourt', name: 'Lagnicourt', lat: 50.155, lon: 2.955, side: 'central', activeFrom: '1916-10-01', activeTo: '1917-03-15', runwayHeadingDeg: 250, runwayLength: 600 },
  { id: 'pronville', name: 'Pronville', lat: 50.170, lon: 3.005, side: 'central', activeFrom: '1917-03-15', activeTo: '1917-11-20', runwayHeadingDeg: 240, runwayLength: 600 },
  { id: 'proville', name: 'Proville (Cambrai)', lat: 50.160, lon: 3.205, side: 'central', activeFrom: '1916-08-01', activeTo: '1918-10-01', runwayHeadingDeg: 260, runwayLength: 650 },
  { id: 'marcke', name: 'Marcke (Courtrai)', lat: 50.800, lon: 3.235, side: 'central', activeFrom: '1916-01-01', activeTo: '1918-10-15', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'harlebeke', name: 'Harlebeke', lat: 50.850, lon: 3.320, side: 'central', activeFrom: '1917-01-01', activeTo: '1918-10-15', runwayHeadingDeg: 250, runwayLength: 600 },
  { id: 'rumbeke', name: 'Rumbeke', lat: 50.930, lon: 3.150, side: 'central', activeFrom: '1917-03-01', activeTo: '1918-10-01', runwayHeadingDeg: 240, runwayLength: 600 },
  { id: 'avesnes-le-sec', name: 'Avesnes-le-Sec', lat: 50.250, lon: 3.380, side: 'central', activeFrom: '1917-11-01', activeTo: '1918-10-10', runwayHeadingDeg: 260, runwayLength: 650 },
  { id: 'lechelle', name: 'Léchelle', lat: 50.050, lon: 2.985, side: 'central', activeFrom: '1918-03-25', activeTo: '1918-08-30', runwayHeadingDeg: 260, runwayLength: 600 },
  { id: 'cappy', name: 'Cappy', lat: 49.925, lon: 2.760, side: 'central', activeFrom: '1918-04-01', activeTo: '1918-08-25', runwayHeadingDeg: 250, runwayLength: 600 },
  { id: 'bernes', name: 'Bernes', lat: 49.910, lon: 3.100, side: 'central', activeFrom: '1917-03-20', activeTo: '1918-09-10', runwayHeadingDeg: 250, runwayLength: 600 },

  // --- British (RFC/RNAS/RAF) ------------------------------------------
  { id: 'bertangles', name: 'Bertangles', lat: 49.972, lon: 2.300, side: 'allied', activeFrom: '1915-07-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'vert-galand', name: 'Vert Galand', lat: 50.130, lon: 2.330, side: 'allied', activeFrom: '1916-01-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'filescamp', name: 'Filescamp Farm (Izel-lès-Hameau)', lat: 50.310, lon: 2.545, side: 'allied', activeFrom: '1916-06-01', activeTo: '1918-11-11', runwayHeadingDeg: 260, runwayLength: 650 },
  { id: 'estree-blanche', name: 'Estrée-Blanche', lat: 50.590, lon: 2.320, side: 'allied', activeFrom: '1917-05-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'bailleul', name: 'Bailleul', lat: 50.735, lon: 2.735, side: 'allied', activeFrom: '1915-07-01', activeTo: '1918-04-12', runwayHeadingDeg: 250, runwayLength: 650 },
  { id: 'ste-marie-cappel', name: 'Ste-Marie-Cappel', lat: 50.785, lon: 2.505, side: 'allied', activeFrom: '1917-01-01', activeTo: '1918-11-11', runwayHeadingDeg: 260, runwayLength: 650 },
  { id: 'baizieux', name: 'Baizieux', lat: 49.995, lon: 2.520, side: 'allied', activeFrom: '1916-06-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 650 },
  { id: 'st-pol', name: 'St-Pol-sur-Mer (Dunkirk)', lat: 51.030, lon: 2.345, side: 'allied', activeFrom: '1915-07-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 800 },

  // --- French -----------------------------------------------------------
  { id: 'cachy', name: 'Cachy', lat: 49.860, lon: 2.470, side: 'allied', activeFrom: '1916-06-01', activeTo: '1918-03-25', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'bierne', name: 'Bierne (Bergues)', lat: 50.965, lon: 2.405, side: 'allied', activeFrom: '1917-06-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700 },

  // --- American (rebased into the sector for gameplay) -------------------
  { id: 'petite-synthe', name: 'Petite-Synthe', lat: 51.020, lon: 2.300, side: 'allied', activeFrom: '1918-03-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700 },
  { id: 'allonville', name: 'Allonville', lat: 49.935, lon: 2.365, side: 'allied', activeFrom: '1918-03-01', activeTo: '1918-11-11', runwayHeadingDeg: 250, runwayLength: 700, rebased: true },
];

export interface AerodromeWorld extends Aerodrome {
  x: number;
  z: number;
}

export const AERODROMES: readonly AerodromeWorld[] = RAW.map((a) => ({ ...a, ...latLonToWorld(a.lat, a.lon) }));

export function getAerodrome(id: string): AerodromeWorld | undefined {
  return AERODROMES.find((a) => a.id === id);
}

export function aerodromesActiveOn(date: string): AerodromeWorld[] {
  return AERODROMES.filter((a) => a.activeFrom <= date && date <= a.activeTo);
}
