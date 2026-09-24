/**
 * Named geography of the sector, in [lat, lon] degrees (convert with
 * src/core/geo.ts latLonToWorld). Consumed by src/world (terrain/land use),
 * src/render (towns, rivers), src/ui (briefing maps) and src/campaign
 * (mission locations: "near Cambrai").
 *
 * Starter data by the lead; the world agent refines/extends it but keeps the
 * exported names and shapes.
 */

export interface Town {
  name: string;
  lat: number;
  lon: number;
  size: 'village' | 'town' | 'city';
}

export interface River {
  name: string;
  /** Polyline, upstream to downstream. */
  points: [number, number][];
  /** Typical width in metres. */
  width: number;
}

export interface Forest {
  name?: string;
  /** Closed polygon. */
  points: [number, number][];
}

export const TOWNS: Town[] = [
  { name: 'Dunkirk', lat: 51.034, lon: 2.377, size: 'city' },
  { name: 'Calais', lat: 50.951, lon: 1.858, size: 'city' },
  { name: 'Ypres', lat: 50.851, lon: 2.885, size: 'town' },
  { name: 'Poperinghe', lat: 50.855, lon: 2.726, size: 'town' },
  { name: 'Dixmude', lat: 51.033, lon: 2.864, size: 'village' },
  { name: 'Passchendaele', lat: 50.9, lon: 3.02, size: 'village' },
  { name: 'Courtrai', lat: 50.828, lon: 3.265, size: 'city' },
  { name: 'Roulers', lat: 50.946, lon: 3.123, size: 'town' },
  { name: 'Menin', lat: 50.797, lon: 3.121, size: 'town' },
  { name: 'Armentières', lat: 50.688, lon: 2.881, size: 'town' },
  { name: 'Bailleul', lat: 50.739, lon: 2.735, size: 'town' },
  { name: 'Hazebrouck', lat: 50.724, lon: 2.538, size: 'town' },
  { name: 'St-Omer', lat: 50.75, lon: 2.252, size: 'town' },
  { name: 'Lille', lat: 50.629, lon: 3.057, size: 'city' },
  { name: 'Béthune', lat: 50.53, lon: 2.64, size: 'town' },
  { name: 'Lens', lat: 50.432, lon: 2.833, size: 'town' },
  { name: 'La Bassée', lat: 50.535, lon: 2.807, size: 'village' },
  { name: 'Douai', lat: 50.371, lon: 3.08, size: 'town' },
  { name: 'Arras', lat: 50.291, lon: 2.777, size: 'town' },
  { name: 'Vimy', lat: 50.372, lon: 2.811, size: 'village' },
  { name: 'Doullens', lat: 50.157, lon: 2.341, size: 'town' },
  { name: 'Bapaume', lat: 50.103, lon: 2.85, size: 'village' },
  { name: 'Cambrai', lat: 50.176, lon: 3.235, size: 'city' },
  { name: 'Valenciennes', lat: 50.358, lon: 3.523, size: 'city' },
  { name: 'Albert', lat: 50.001, lon: 2.652, size: 'town' },
  { name: 'Amiens', lat: 49.894, lon: 2.296, size: 'city' },
  { name: 'Villers-Bretonneux', lat: 49.868, lon: 2.519, size: 'village' },
  { name: 'Péronne', lat: 49.932, lon: 2.936, size: 'town' },
  { name: 'St-Quentin', lat: 49.848, lon: 3.287, size: 'city' },
  { name: 'Montdidier', lat: 49.648, lon: 2.57, size: 'town' },
  { name: 'Roye', lat: 49.7, lon: 2.79, size: 'village' },
  { name: 'Ham', lat: 49.747, lon: 3.073, size: 'village' },
];

export const RIVERS: River[] = [
  { name: 'Somme', width: 40, points: [[49.85, 3.29], [49.8, 3.1], [49.9, 2.96], [49.93, 2.93], [49.9, 2.75], [49.94, 2.6], [49.9, 2.4], [49.894, 2.3], [49.98, 2.1], [50.1, 1.83]] },
  { name: 'Ancre', width: 12, points: [[50.07, 2.72], [50.0, 2.65], [49.95, 2.55], [49.93, 2.46]] },
  { name: 'Scarpe', width: 18, points: [[50.29, 2.75], [50.3, 2.9], [50.33, 3.0], [50.37, 3.08], [50.42, 3.3], [50.5, 3.43]] },
  { name: 'Escaut (Scheldt)', width: 30, points: [[49.95, 3.25], [50.18, 3.24], [50.36, 3.52], [50.6, 3.39], [50.83, 3.28], [50.95, 3.52]] },
  { name: 'Lys', width: 25, points: [[50.63, 2.4], [50.7, 2.6], [50.69, 2.88], [50.78, 3.1], [50.83, 3.27], [50.98, 3.52]] },
  { name: 'Yser', width: 25, points: [[50.78, 2.4], [50.9, 2.7], [51.03, 2.86], [51.14, 2.74]] },
];

/** Channel/North Sea coastline, south to north-east. Sea lies to the north-west. */
export const COASTLINE: [number, number][] = [
  [50.2, 1.6], [50.5, 1.58], [50.75, 1.6], [50.87, 1.6], [50.97, 1.85], [51.02, 2.1], [51.05, 2.37], [51.1, 2.6], [51.18, 2.8], [51.25, 3.0],
];

export const FORESTS: Forest[] = [
  { name: 'Bois de Bourlon', points: [[50.19, 3.1], [50.2, 3.14], [50.18, 3.15], [50.17, 3.11]] },
  { name: 'Forêt de Nieppe', points: [[50.72, 2.55], [50.73, 2.65], [50.68, 2.66], [50.67, 2.56]] },
  { name: 'Houthulst Forest', points: [[50.98, 2.92], [51.0, 2.98], [50.96, 3.0], [50.95, 2.93]] },
];
