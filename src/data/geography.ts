/**
 * Named geography of the sector, in [lat, lon] degrees (convert with
 * src/core/geo.ts latLonToWorld). Consumed by src/world (terrain/land use),
 * src/render (towns, rivers), src/ui (briefing maps) and src/campaign
 * (mission locations: "near Cambrai").
 *
 * Positions are approximate (±1 km) — good enough for a navigable,
 * recognisable map, not a survey.
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

const T = (name: string, lat: number, lon: number, size: Town['size'] = 'village'): Town => ({ name, lat, lon, size });

export const TOWNS: Town[] = [
  // --- Cities & towns --------------------------------------------------------
  T('Dunkirk', 51.034, 2.377, 'city'),
  T('Calais', 50.951, 1.858, 'city'),
  T('Boulogne', 50.726, 1.614, 'city'),
  T('Ostend', 51.225, 2.915, 'city'),
  T('Bruges', 51.209, 3.225, 'city'),
  T('Ghent', 51.054, 3.717, 'city'),
  T('Lille', 50.629, 3.057, 'city'),
  T('Roubaix', 50.69, 3.18, 'city'),
  T('Tourcoing', 50.724, 3.161, 'town'),
  T('Courtrai', 50.828, 3.265, 'city'),
  T('Tournai', 50.606, 3.389, 'city'),
  T('Valenciennes', 50.358, 3.523, 'city'),
  T('Cambrai', 50.176, 3.235, 'city'),
  T('St-Quentin', 49.848, 3.287, 'city'),
  T('Amiens', 49.894, 2.296, 'city'),
  T('Abbeville', 50.105, 1.835, 'city'),
  T('Ypres', 50.851, 2.885, 'town'),
  T('Poperinghe', 50.855, 2.726, 'town'),
  T('Furnes', 51.074, 2.662, 'town'),
  T('Nieuport', 51.13, 2.75, 'town'),
  T('Dixmude', 51.033, 2.864, 'town'),
  T('Roulers', 50.946, 3.123, 'town'),
  T('Thourout', 51.065, 3.1, 'town'),
  T('Menin', 50.797, 3.121, 'town'),
  T('Armentières', 50.688, 2.881, 'town'),
  T('Bailleul', 50.739, 2.735, 'town'),
  T('Hazebrouck', 50.724, 2.538, 'town'),
  T('Cassel', 50.8, 2.487, 'village'),
  T('St-Omer', 50.75, 2.252, 'town'),
  T('Aire-sur-la-Lys', 50.639, 2.396, 'town'),
  T('Béthune', 50.53, 2.64, 'town'),
  T('Lens', 50.432, 2.833, 'town'),
  T('Douai', 50.371, 3.08, 'town'),
  T('Arras', 50.291, 2.777, 'town'),
  T('St-Pol', 50.382, 2.335, 'town'),
  T('Doullens', 50.157, 2.341, 'town'),
  T('Albert', 50.001, 2.652, 'town'),
  T('Péronne', 49.932, 2.936, 'town'),
  T('Montdidier', 49.648, 2.57, 'town'),
  T('Le Cateau', 50.103, 3.542, 'town'),
  T('Caudry', 50.125, 3.412, 'town'),
  T('Montreuil', 50.464, 1.764, 'town'),
  // --- Villages (many are famous battlefields) -------------------------------
  T('Passchendaele', 50.9, 3.02),
  T('Langemarck', 50.912, 2.918),
  T('Poelcappelle', 50.918, 2.96),
  T('Zonnebeke', 50.872, 2.987),
  T('Gheluvelt', 50.835, 2.99),
  T('Zillebeke', 50.835, 2.925),
  T('Wytschaete', 50.785, 2.88),
  T('Messines', 50.765, 2.897),
  T('Kemmel', 50.782, 2.827),
  T('Vlamertinghe', 50.853, 2.82),
  T('Elverdinghe', 50.885, 2.81),
  T('Boesinghe', 50.895, 2.855),
  T('Houthulst', 50.975, 2.95),
  T('Staden', 50.975, 3.015),
  T('Moorslede', 50.89, 3.07),
  T('Wervik', 50.78, 3.04),
  T('Comines', 50.767, 3.0),
  T('Warneton', 50.752, 2.95),
  T('Ploegsteert', 50.726, 2.88),
  T('Steenvoorde', 50.81, 2.583),
  T('Estaires', 50.645, 2.724),
  T('Merville', 50.643, 2.641),
  T('Fleurbaix', 50.65, 2.83),
  T('Fromelles', 50.605, 2.855),
  T('Aubers', 50.595, 2.83),
  T('Neuve-Chapelle', 50.583, 2.78),
  T('Festubert', 50.545, 2.735),
  T('Givenchy', 50.527, 2.76),
  T('La Bassée', 50.535, 2.807),
  T('Lillers', 50.563, 2.483),
  T('Bruay', 50.483, 2.55),
  T('Loos', 50.458, 2.795),
  T('Liévin', 50.422, 2.779),
  T('Souchez', 50.392, 2.745),
  T('Carency', 50.378, 2.703),
  T('Vimy', 50.372, 2.811),
  T('Thélus', 50.354, 2.8),
  T('Farbus', 50.352, 2.824),
  T('Neuville-St-Vaast', 50.356, 2.759),
  T('Hénin-Liétard', 50.42, 2.935),
  T('Carvin', 50.49, 2.957),
  T('Seclin', 50.548, 3.03),
  T('Oppy', 50.35, 2.893),
  T('Gavrelle', 50.328, 2.888),
  T('Roeux', 50.298, 2.9),
  T('Monchy-le-Preux', 50.273, 2.892),
  T('Wancourt', 50.25, 2.867),
  T('Croisilles', 50.2, 2.88),
  T('Bullecourt', 50.19, 2.928),
  T('Quéant', 50.18, 2.98),
  T('Marquion', 50.21, 3.085),
  T('Bourlon', 50.178, 3.115),
  T('Flesquières', 50.13, 3.115),
  T('Havrincourt', 50.11, 3.085),
  T('Marcoing', 50.12, 3.18),
  T('Masnières', 50.115, 3.207),
  T('Gouzeaucourt', 50.057, 3.12),
  T('Épehy', 50.0, 3.13),
  T('Roisel', 49.948, 3.1),
  T('Vermand', 49.875, 3.15),
  T('Avesnes-le-Comte', 50.277, 2.53),
  T('Beaumetz', 50.24, 2.66),
  T('Hébuterne', 50.125, 2.636),
  T('Serre', 50.1, 2.66),
  T('Beaumont-Hamel', 50.084, 2.656),
  T('Thiepval', 50.054, 2.686),
  T('Pozières', 50.037, 2.726),
  T('La Boisselle', 50.02, 2.697),
  T('Contalmaison', 50.025, 2.735),
  T('Fricourt', 49.997, 2.715),
  T('Mametz', 49.995, 2.735),
  T('Longueval', 50.027, 2.8),
  T('Guillemont', 50.01, 2.82),
  T('Ginchy', 50.02, 2.835),
  T('Flers', 50.047, 2.826),
  T('Combles', 50.01, 2.865),
  T('Le Transloy', 50.057, 2.887),
  T('Bapaume', 50.103, 2.85, 'town'),
  T('Bertincourt', 50.083, 2.98),
  T('Maricourt', 49.98, 2.79),
  T('Bray-sur-Somme', 49.94, 2.72),
  T('Corbie', 49.908, 2.51),
  T('Villers-Bretonneux', 49.868, 2.519),
  T('Hamel', 49.9, 2.58),
  T('Moreuil', 49.775, 2.485),
  T('Chaulnes', 49.815, 2.8),
  T('Nesle', 49.758, 2.91),
  T('Ham', 49.747, 3.073),
  T('Roye', 49.7, 2.79),
  T('Mailly-Maillet', 50.08, 2.6),
  T('Acheux', 50.07, 2.53),
  T('Frévent', 50.277, 2.29),
  T('Auxi-le-Château', 50.23, 2.115),
  T('Bernaville', 50.132, 2.165),
];

export const RIVERS: River[] = [
  { name: 'Somme', width: 40, points: [[49.83, 3.3], [49.8, 3.1], [49.86, 2.99], [49.92, 2.94], [49.925, 2.87], [49.94, 2.82], [49.93, 2.73], [49.92, 2.64], [49.905, 2.52], [49.89, 2.4], [49.894, 2.3], [49.95, 2.2], [49.99, 2.05], [50.1, 1.84], [50.2, 1.6]] },
  { name: 'Ancre', width: 12, points: [[50.08, 2.74], [50.04, 2.69], [50.0, 2.655], [49.95, 2.58], [49.91, 2.52]] },
  { name: 'Avre', width: 15, points: [[49.64, 2.62], [49.72, 2.52], [49.8, 2.46], [49.86, 2.37], [49.89, 2.31]] },
  { name: 'Scarpe', width: 18, points: [[50.29, 2.62], [50.29, 2.75], [50.3, 2.9], [50.33, 3.0], [50.37, 3.08], [50.42, 3.3], [50.5, 3.43]] },
  { name: 'Sensée', width: 12, points: [[50.2, 2.84], [50.25, 3.0], [50.27, 3.13], [50.3, 3.28], [50.3, 3.4]] },
  { name: 'Escaut (Scheldt)', width: 30, points: [[49.95, 3.25], [50.07, 3.2], [50.18, 3.24], [50.28, 3.34], [50.36, 3.52], [50.5, 3.48], [50.6, 3.39], [50.72, 3.35], [50.83, 3.4], [50.95, 3.55], [51.05, 3.72]] },
  { name: 'Lys', width: 25, points: [[50.6, 2.25], [50.63, 2.4], [50.65, 2.6], [50.66, 2.72], [50.69, 2.88], [50.74, 2.97], [50.78, 3.1], [50.83, 3.27], [50.9, 3.42], [51.05, 3.72]] },
  { name: 'Deûle', width: 18, points: [[50.43, 2.84], [50.5, 2.92], [50.58, 3.0], [50.64, 3.03], [50.7, 2.98], [50.74, 2.97]] },
  { name: 'Yser', width: 25, points: [[50.78, 2.35], [50.84, 2.5], [50.9, 2.7], [50.97, 2.8], [51.03, 2.86], [51.1, 2.8], [51.15, 2.73]] },
  { name: 'Ypres–Yser Canal', width: 18, points: [[50.84, 2.89], [50.9, 2.86], [50.96, 2.85], [51.0, 2.86]] },
  { name: 'Canal du Nord', width: 20, points: [[49.72, 2.98], [49.9, 3.0], [50.05, 3.05], [50.14, 3.07], [50.21, 3.08], [50.26, 3.08]] },
  { name: 'Canche', width: 18, points: [[50.33, 2.4], [50.36, 2.2], [50.42, 1.95], [50.47, 1.76], [50.52, 1.62]] },
  { name: 'Authie', width: 14, points: [[50.1, 2.55], [50.17, 2.35], [50.25, 2.1], [50.33, 1.85], [50.37, 1.6]] },
  { name: 'Aa', width: 16, points: [[50.65, 2.1], [50.75, 2.25], [50.88, 2.18], [50.98, 2.13], [51.0, 2.1]] },
];

/** Channel/North Sea coastline, south to north-east. Sea lies to the west/north-west (left of travel). */
export const COASTLINE: [number, number][] = [
  [49.3, 1.2], [49.75, 1.45], [50.1, 1.58], [50.2, 1.56], [50.5, 1.58], [50.73, 1.59], [50.87, 1.575],
  [50.93, 1.72], [50.965, 1.85], [50.99, 2.05], [51.01, 2.15], [51.045, 2.37], [51.09, 2.55], [51.15, 2.72],
  [51.23, 2.9], [51.3, 3.1], [51.37, 3.37], [51.42, 3.6], [51.5, 4.0],
];

export const FORESTS: Forest[] = [
  { name: 'Bois de Bourlon', points: [[50.19, 3.1], [50.2, 3.14], [50.18, 3.15], [50.17, 3.11]] },
  { name: 'Forêt de Nieppe', points: [[50.72, 2.55], [50.73, 2.65], [50.68, 2.66], [50.67, 2.56]] },
  { name: 'Houthulst Forest', points: [[50.98, 2.92], [51.0, 2.98], [50.96, 3.0], [50.95, 2.93]] },
  { name: 'Polygon Wood', points: [[50.862, 2.985], [50.864, 2.997], [50.855, 2.998], [50.853, 2.987]] },
  { name: 'Delville Wood', points: [[50.03, 2.805], [50.031, 2.815], [50.024, 2.815], [50.023, 2.805]] },
  { name: 'High Wood', points: [[50.047, 2.782], [50.049, 2.792], [50.041, 2.793], [50.04, 2.783]] },
  { name: 'Bois de Havrincourt', points: [[50.1, 3.03], [50.105, 3.07], [50.085, 3.075], [50.08, 3.035]] },
  { name: 'Forêt de Mormal', points: [[50.25, 3.68], [50.25, 3.8], [50.17, 3.82], [50.16, 3.7]] },
  { name: 'Forêt de Clairmarais', points: [[50.79, 2.28], [50.8, 2.33], [50.77, 2.34], [50.765, 2.29]] },
  { name: 'Forêt de Crécy', points: [[50.27, 1.85], [50.28, 1.98], [50.23, 1.99], [50.22, 1.86]] },
  { name: 'Bois de Lucheux', points: [[50.21, 2.37], [50.21, 2.44], [50.18, 2.44], [50.18, 2.38]] },
  { name: 'Forêt de Raismes', points: [[50.43, 3.4], [50.44, 3.52], [50.38, 3.53], [50.38, 3.42]] },
];
