/**
 * Local fixture specs for sim tests (not used at runtime). Track B owns the real bombers in
 * src/data/aircraft.ts; these stand in so the sim can be built and tested before they land.
 */
import type { AircraftId, AircraftSpec } from '../../core/types';

/**
 * A Gotha-like heavy twin: three crew, explicit stations (the nose gunner is the bomb
 * aimer; the rear gunner works both the dorsal ring and the ventral tunnel), two engines
 * on nacelles 2.4 m out, and two bomb stores so the release order can be tested.
 */
export const TEST_TWIN: AircraftSpec = {
  id: 'test_twin' as AircraftId,
  name: 'Test Twin G.V',
  shortName: 'T.G.V',
  manufacturer: 'Test',
  nation: 'germany',
  alsoUsedBy: [],
  role: 'bomber',
  flyable: false,
  introduced: '1917-06-01',
  retired: '1918-11-11',
  description: 'Sim test fixture.',
  geometry: {
    layout: 'biplane',
    pusher: false,
    span: 23.7,
    lowerSpan: 22.0,
    middleSpan: 0,
    chord: 2.4,
    lowerChord: 2.4,
    gap: 2.2,
    stagger: 0,
    dihedralDeg: 2,
    length: 12.4,
    height: 4.3,
    fuselageWidth: 1.1,
    fuselageShape: 'slab',
    tailShape: 'squared',
    crew: 3,
    wheelTrack: 4.5,
    nacelleOffsetX: 2.4,
  },
  performance: {
    massLoaded: 3975,
    massEmpty: 2740,
    wingArea: 89.5,
    enginePowerHp: 520,
    engineCount: 2,
    engineType: 'twin-inline',
    engineName: '2 x Mercedes D.IVa',
    maxSpeedKmh: 140,
    maxSpeedAltM: 0,
    ceilingM: 6500,
    climbTo3000mMin: 28,
    enduranceHours: 6,
    rollRate: 0.25,
    pitchRate: 0.3,
    structuralStrength: 0.8,
    fuelCapacityL: 700,
  },
  guns: [
    { type: 'parabellum', position: [0, 0.6, -4.2], mount: 'flexible', rounds: 100, spareDrums: 6 },
    { type: 'parabellum', position: [0, 1.0, 1.6], mount: 'flexible', rounds: 100, spareDrums: 6 },
    { type: 'parabellum', position: [0, -0.4, 2.2], mount: 'flexible', rounds: 100, spareDrums: 6 },
  ],
  crewStations: [
    { id: 'pilot', label: 'Pilot', crewIndex: 0, guns: [], arcs: [], eye: [0, 1.1, -2.6] },
    {
      id: 'nose',
      label: 'Nose gunner',
      crewIndex: 1,
      guns: [0],
      arcs: [{ azimuthDeg: [-120, 120], elevationDeg: [-50, 90] }],
      bombAimer: true,
    },
    {
      id: 'dorsal',
      label: 'Rear gunner (dorsal)',
      crewIndex: 2,
      guns: [1],
      arcs: [
        { azimuthDeg: [45, -45], elevationDeg: [0, 90] },
        { azimuthDeg: [-180, 180], elevationDeg: [40, 90] },
      ],
    },
    {
      id: 'ventral',
      label: 'Rear gunner (tunnel)',
      crewIndex: 2,
      guns: [2],
      arcs: [{ azimuthDeg: [120, -120], elevationDeg: [-80, -5] }],
    },
  ],
  bombs: [
    { name: 'P.u.W. 50 kg', massKg: 50, explosiveKg: 22, count: 6 },
    { name: 'P.u.W. 300 kg', massKg: 300, explosiveKg: 150, count: 1 },
  ],
};
