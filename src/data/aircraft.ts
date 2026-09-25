/**
 * Aircraft roster: historical specifications (approximate, from standard
 * references). `performance` holds historical figures; the flight model in
 * src/sim derives aerodynamic coefficients from them and is tuned so each
 * type roughly reproduces its max speed, climb and ceiling.
 *
 * Geometry is consumed by the model pipeline (tools/blender) and the runtime
 * fallback mesh builder. Gun positions are in body frame (fwd = -Z, up = +Y).
 */
import type { AircraftGeometry, AircraftId, AircraftPerformance, AircraftSpec, GunMount, GunSpec, GunType } from '../core/types';

export const GUNS: Record<GunType, GunSpec> = {
  spandau: { type: 'spandau', name: 'LMG 08/15 "Spandau"', rpmSynchronized: 450, rpmFree: 550, muzzleVelocity: 870, bulletMass: 0.0128, jamChancePerRound: 0.0006, drumChangeTime: 0 },
  parabellum: { type: 'parabellum', name: 'Parabellum MG 14', rpmSynchronized: 600, rpmFree: 650, muzzleVelocity: 870, bulletMass: 0.0128, jamChancePerRound: 0.0005, drumChangeTime: 4 },
  vickers: { type: 'vickers', name: 'Vickers .303', rpmSynchronized: 450, rpmFree: 500, muzzleVelocity: 745, bulletMass: 0.0113, jamChancePerRound: 0.0007, drumChangeTime: 0 },
  lewis: { type: 'lewis', name: 'Lewis .303', rpmSynchronized: 550, rpmFree: 550, muzzleVelocity: 745, bulletMass: 0.0113, jamChancePerRound: 0.0004, drumChangeTime: 5 },
};

const sync = (type: 'spandau' | 'vickers', x: number, rounds = 500): GunMount => ({
  type,
  position: [x, 0.55, -1.6],
  mount: 'fixed-synchronized',
  rounds,
  spareDrums: 0,
});
const overwingLewis = (y = 1.6, z = -0.9): GunMount => ({ type: 'lewis', position: [0, y, z], mount: 'fixed-overwing', rounds: 97, spareDrums: 4 });
const rearGun = (type: 'lewis' | 'parabellum'): GunMount => ({ type, position: [0, 0.9, 0.9], mount: 'flexible', rounds: 97, spareDrums: 6 });
/** Observer's gun ahead of the pilot (B.E.2c front seat, pusher nose); early 47-round Lewis drums. */
const frontGun = (position: [number, number, number]): GunMount => ({ type: 'lewis', position, mount: 'flexible', rounds: 47, spareDrums: 8 });

function geom(g: Partial<AircraftGeometry> & Pick<AircraftGeometry, 'layout' | 'span' | 'length' | 'chord'>): AircraftGeometry {
  return {
    pusher: false,
    lowerSpan: g.layout === 'monoplane' || g.layout === 'parasol' ? 0 : g.span * 0.95,
    middleSpan: 0,
    lowerChord: g.chord,
    gap: g.layout === 'monoplane' ? 0 : 1.3,
    stagger: 0.3,
    dihedralDeg: 1.5,
    height: 2.6,
    fuselageWidth: 0.8,
    fuselageShape: 'slab',
    tailShape: 'rounded',
    crew: 1,
    wheelTrack: 1.6,
    ...g,
  };
}

function perf(p: Omit<AircraftPerformance, 'rollRate' | 'pitchRate' | 'structuralStrength' | 'fuelCapacityL'> & Partial<AircraftPerformance>): AircraftPerformance {
  return { rollRate: 0.8, pitchRate: 0.8, structuralStrength: 0.8, fuelCapacityL: 100, ...p };
}

const SPECS: AircraftSpec[] = [
  // ======================================================= Central Powers
  {
    id: 'fokker_eiii', name: 'Fokker E.III Eindecker', shortName: 'E.III', manufacturer: 'Fokker', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1915-07-01', retired: '1916-09-01',
    description: 'The monoplane that began the "Fokker Scourge". Its synchronised machine gun let a pilot aim the whole aeroplane at his foe. Wing-warping gives sluggish roll; it is slow by 1916 standards.',
    geometry: geom({ layout: 'monoplane', span: 9.52, length: 7.2, chord: 1.8, height: 2.4, fuselageWidth: 0.7, tailShape: 'comma', dihedralDeg: 0, wheelTrack: 1.8 }),
    performance: perf({ massLoaded: 610, massEmpty: 399, wingArea: 16.0, enginePowerHp: 100, engineType: 'rotary', engineName: 'Oberursel U.I', maxSpeedKmh: 140, maxSpeedAltM: 0, ceilingM: 3600, climbTo3000mMin: 30, enduranceHours: 1.5, rollRate: 0.45, pitchRate: 0.7, structuralStrength: 0.7, fuelCapacityL: 80 }),
    guns: [sync('spandau', 0, 600)],
  },
  {
    id: 'albatros_dii', name: 'Albatros D.II', shortName: 'D.II', manufacturer: 'Albatros Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1916-08-15', retired: '1917-06-01',
    description: 'Twin guns and a powerful Mercedes gave the Jagdstaffeln back the sky over the Somme. Its shark-like plywood fuselage is strong; handling is steady rather than nimble.',
    geometry: geom({ layout: 'biplane', span: 8.5, lowerSpan: 8.0, length: 7.4, chord: 1.7, lowerChord: 1.5, gap: 1.35, stagger: 0.35, height: 2.64, fuselageShape: 'plywood-oval', tailShape: 'rounded' }),
    performance: perf({ massLoaded: 888, massEmpty: 637, wingArea: 24.5, enginePowerHp: 160, engineType: 'inline', engineName: 'Mercedes D.III', maxSpeedKmh: 175, maxSpeedAltM: 1000, ceilingM: 5180, climbTo3000mMin: 19, enduranceHours: 1.5, rollRate: 0.7, pitchRate: 0.75, structuralStrength: 0.85, fuelCapacityL: 120 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'albatros_diii', name: 'Albatros D.III', shortName: 'D.III', manufacturer: 'Albatros Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1917-01-01', retired: '1918-03-01',
    description: 'The mount of "Bloody April" 1917. Nieuport-style sesquiplane wings improve climb and view, but the single-spar lower wing can twist and fail in a hard dive.',
    geometry: geom({ layout: 'sesquiplane', span: 9.04, lowerSpan: 8.7, length: 7.33, chord: 1.7, lowerChord: 1.0, gap: 1.2, stagger: 0.4, height: 2.98, fuselageShape: 'plywood-oval', tailShape: 'rounded' }),
    performance: perf({ massLoaded: 886, massEmpty: 695, wingArea: 20.5, enginePowerHp: 170, engineType: 'inline', engineName: 'Mercedes D.IIIa', maxSpeedKmh: 175, maxSpeedAltM: 1000, ceilingM: 5500, climbTo3000mMin: 12, enduranceHours: 2, rollRate: 0.75, pitchRate: 0.8, structuralStrength: 0.6, fuelCapacityL: 120 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'albatros_dv', name: 'Albatros D.V', shortName: 'D.V', manufacturer: 'Albatros Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1917-05-15', retired: '1918-11-11',
    description: 'A refined D.III with an oval fuselage and a higher-compression engine. Built in great numbers and flown until the Armistice, though outclassed by the S.E.5a and Camel. Beware the lower wing in steep dives.',
    geometry: geom({ layout: 'sesquiplane', span: 9.05, lowerSpan: 8.7, length: 7.33, chord: 1.7, lowerChord: 1.0, gap: 1.2, stagger: 0.4, height: 2.7, fuselageShape: 'plywood-oval', tailShape: 'rounded' }),
    performance: perf({ massLoaded: 937, massEmpty: 687, wingArea: 21.2, enginePowerHp: 185, engineType: 'inline', engineName: 'Mercedes D.IIIaü', maxSpeedKmh: 186, maxSpeedAltM: 1000, ceilingM: 5700, climbTo3000mMin: 11.5, enduranceHours: 2, rollRate: 0.75, pitchRate: 0.8, structuralStrength: 0.55, fuelCapacityL: 120 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'pfalz_diiia', name: 'Pfalz D.IIIa', shortName: 'D.IIIa', manufacturer: 'Pfalz Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1917-12-01', retired: '1918-11-11',
    description: 'A sturdy Bavarian fighter with a monocoque fuselage. Slower in the climb than an Albatros but a far safer diver - an excellent balloon-buster.',
    geometry: geom({ layout: 'sesquiplane', span: 9.4, lowerSpan: 8.5, length: 6.95, chord: 1.65, lowerChord: 1.1, gap: 1.25, stagger: 0.35, height: 2.67, fuselageShape: 'plywood-oval', tailShape: 'rounded' }),
    performance: perf({ massLoaded: 935, massEmpty: 695, wingArea: 21.7, enginePowerHp: 180, engineType: 'inline', engineName: 'Mercedes D.IIIa', maxSpeedKmh: 170, maxSpeedAltM: 1000, ceilingM: 5180, climbTo3000mMin: 13, enduranceHours: 2.5, rollRate: 0.7, pitchRate: 0.75, structuralStrength: 0.95, fuelCapacityL: 125 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'fokker_dri', name: 'Fokker Dr.I Dreidecker', shortName: 'Dr.I', manufacturer: 'Fokker', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1917-08-28', retired: '1918-07-01',
    description: 'The Red Baron\'s triplane. Slow on the level but it climbs like a lift and turns inside anything in the sky. The rotary engine\'s torque and a sensitive rudder demand a firm hand.',
    geometry: geom({ layout: 'triplane', span: 7.19, middleSpan: 6.23, lowerSpan: 5.73, length: 5.77, chord: 1.0, lowerChord: 1.0, gap: 0.85, stagger: 0.15, height: 2.95, fuselageWidth: 0.72, tailShape: 'triangular', dihedralDeg: 0, wheelTrack: 1.66 }),
    performance: perf({ massLoaded: 586, massEmpty: 406, wingArea: 18.7, enginePowerHp: 110, engineType: 'rotary', engineName: 'Oberursel Ur.II', maxSpeedKmh: 165, maxSpeedAltM: 1000, ceilingM: 6100, climbTo3000mMin: 8.5, enduranceHours: 1.5, rollRate: 0.9, pitchRate: 1.0, structuralStrength: 0.7, fuelCapacityL: 72 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'fokker_dvii', name: 'Fokker D.VII', shortName: 'D.VII', manufacturer: 'Fokker', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1918-05-01', retired: '1918-11-11',
    description: 'The finest German fighter of the war - the Armistice singled it out for surrender. Thick cantilever wings let it "hang on its propeller" at high angles of attack. Forgiving, fast, and deadly at altitude.',
    geometry: geom({ layout: 'biplane', span: 8.9, lowerSpan: 7.0, length: 6.95, chord: 1.6, lowerChord: 1.3, gap: 1.3, stagger: 0.45, height: 2.75, tailShape: 'comma' }),
    performance: perf({ massLoaded: 906, massEmpty: 670, wingArea: 20.5, enginePowerHp: 185, engineType: 'inline', engineName: 'BMW IIIa', maxSpeedKmh: 200, maxSpeedAltM: 1000, ceilingM: 7000, climbTo3000mMin: 8.5, enduranceHours: 1.5, rollRate: 0.85, pitchRate: 0.9, structuralStrength: 0.95, fuelCapacityL: 90 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'fokker_dviii', name: 'Fokker D.VIII', shortName: 'D.VIII', manufacturer: 'Fokker', nation: 'germany', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1918-08-01', retired: '1918-11-11',
    description: 'The "Flying Razor": a parasol monoplane with a thick wooden wing. Light and agile, it arrived in the last weeks of the war.',
    geometry: geom({ layout: 'parasol', span: 8.4, length: 5.86, chord: 1.4, gap: 0.7, height: 2.82, fuselageWidth: 0.72, tailShape: 'comma', dihedralDeg: 0 }),
    performance: perf({ massLoaded: 605, massEmpty: 405, wingArea: 10.7, enginePowerHp: 110, engineType: 'rotary', engineName: 'Oberursel Ur.II', maxSpeedKmh: 190, maxSpeedAltM: 0, ceilingM: 6300, climbTo3000mMin: 8.5, enduranceHours: 1.5, rollRate: 0.95, pitchRate: 0.9, structuralStrength: 0.8, fuelCapacityL: 75 }),
    guns: [sync('spandau', -0.12), sync('spandau', 0.12)],
  },
  {
    id: 'halberstadt_clii', name: 'Halberstadt CL.II', shortName: 'CL.II', manufacturer: 'Halberstädter Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1917-08-01', retired: '1918-11-11',
    description: 'A compact two-seat escort and ground-attack aeroplane. The observer shares a single cockpit with the pilot and wields a Parabellum.',
    geometry: geom({ layout: 'biplane', span: 10.77, lowerSpan: 10.3, length: 7.3, chord: 1.6, gap: 1.5, stagger: 0.3, height: 2.75, crew: 2, tailShape: 'squared', wheelTrack: 1.9 }),
    performance: perf({ massLoaded: 1133, massEmpty: 773, wingArea: 27.5, enginePowerHp: 160, engineType: 'inline', engineName: 'Mercedes D.III', maxSpeedKmh: 165, maxSpeedAltM: 1000, ceilingM: 5100, climbTo3000mMin: 15, enduranceHours: 3, rollRate: 0.6, pitchRate: 0.6, structuralStrength: 0.9, fuelCapacityL: 160 }),
    guns: [sync('spandau', 0), rearGun('parabellum')],
  },
  {
    id: 'rumpler_civ', name: 'Rumpler C.IV', shortName: 'C.IV', manufacturer: 'Rumpler', nation: 'germany', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1917-01-01', retired: '1918-11-11',
    description: 'A high-flying reconnaissance two-seater. Its photographs guide the German artillery; bringing one down is a prized assignment.',
    geometry: geom({ layout: 'biplane', span: 12.66, lowerSpan: 12.0, length: 8.4, chord: 1.75, gap: 1.7, stagger: 0.4, height: 3.25, crew: 2, tailShape: 'rounded', fuselageWidth: 0.95, wheelTrack: 2.1 }),
    performance: perf({ massLoaded: 1630, massEmpty: 1080, wingArea: 33.5, enginePowerHp: 260, engineType: 'inline', engineName: 'Mercedes D.IVa', maxSpeedKmh: 170, maxSpeedAltM: 1000, ceilingM: 6400, climbTo3000mMin: 18, enduranceHours: 3.5, rollRate: 0.45, pitchRate: 0.5, structuralStrength: 0.85, fuelCapacityL: 250 }),
    guns: [sync('spandau', 0), rearGun('parabellum')],
  },

  {
    id: 'albatros_ciii', name: 'Albatros C.III', shortName: 'C.III', manufacturer: 'Albatros Flugzeugwerke', nation: 'germany', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1915-12-01', retired: '1917-06-01',
    description: 'The most numerous German two-seater of 1916: a sturdy reconnaissance and artillery machine with the observer behind the pilot, where his Parabellum commands the rear. Later machines added a fixed gun for the pilot.',
    geometry: geom({ layout: 'biplane', span: 11.69, lowerSpan: 11.0, length: 8.0, chord: 1.75, gap: 1.8, stagger: 0.3, height: 3.07, dihedralDeg: 2, crew: 2, tailShape: 'rounded', fuselageShape: 'round', fuselageWidth: 0.95, wheelTrack: 2.0 }),
    performance: perf({ massLoaded: 1353, massEmpty: 851, wingArea: 36.91, enginePowerHp: 150, engineType: 'inline', engineName: 'Benz Bz.III', maxSpeedKmh: 140, maxSpeedAltM: 0, ceilingM: 3350, climbTo3000mMin: 35, enduranceHours: 4, rollRate: 0.45, pitchRate: 0.5, structuralStrength: 0.8, fuelCapacityL: 160 }),
    guns: [sync('spandau', 0), rearGun('parabellum')],
  },

  // ============================================================== Allies
  {
    id: 'airco_dh2', name: 'Airco D.H.2', shortName: 'D.H.2', manufacturer: 'Airco', nation: 'britain', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1916-02-01', retired: '1917-06-01',
    description: 'A pusher scout that ended the Fokker Scourge. With the engine behind you, the Lewis gun fires straight ahead unhindered - and the view forward is superb. The Monosoupape rotary has a mind of its own.',
    geometry: geom({ layout: 'biplane', pusher: true, span: 8.61, lowerSpan: 8.61, length: 7.68, chord: 1.4, gap: 1.4, stagger: 0, height: 2.91, fuselageWidth: 0.7, tailShape: 'squared', dihedralDeg: 3 }),
    performance: perf({ massLoaded: 654, massEmpty: 428, wingArea: 22.8, enginePowerHp: 100, engineType: 'rotary', engineName: 'Gnome Monosoupape', maxSpeedKmh: 150, maxSpeedAltM: 0, ceilingM: 4265, climbTo3000mMin: 24, enduranceHours: 2.75, rollRate: 0.75, pitchRate: 0.8, structuralStrength: 0.75, fuelCapacityL: 110 }),
    guns: [{ type: 'lewis', position: [0, 0.3, -1.8], mount: 'fixed-pusher', rounds: 97, spareDrums: 5 }],
  },
  {
    id: 'nieuport_11', name: 'Nieuport 11 Bébé', shortName: 'N.11', manufacturer: 'Nieuport', nation: 'france', alsoUsedBy: ['britain'],
    role: 'fighter', flyable: true, introduced: '1916-01-05', retired: '1916-12-31',
    description: 'A tiny sesquiplane "baby" with a Lewis gun on the top wing firing over the propeller. Nimble and quick to climb, it fought the Fokkers to a standstill over Verdun and the Somme.',
    geometry: geom({ layout: 'sesquiplane', span: 7.55, lowerSpan: 7.4, length: 5.8, chord: 1.2, lowerChord: 0.7, gap: 1.2, stagger: 0.3, height: 2.4, fuselageWidth: 0.7, tailShape: 'comma', fuselageShape: 'slab' }),
    performance: perf({ massLoaded: 480, massEmpty: 320, wingArea: 13.3, enginePowerHp: 80, engineType: 'rotary', engineName: 'Le Rhône 9C', maxSpeedKmh: 156, maxSpeedAltM: 0, ceilingM: 4600, climbTo3000mMin: 15, enduranceHours: 2.5, rollRate: 0.9, pitchRate: 0.9, structuralStrength: 0.6, fuelCapacityL: 70 }),
    guns: [overwingLewis(1.5, -0.6)],
  },
  {
    id: 'nieuport_17', name: 'Nieuport 17', shortName: 'N.17', manufacturer: 'Nieuport', nation: 'france', alsoUsedBy: ['britain'],
    role: 'fighter', flyable: true, introduced: '1916-05-01', retired: '1917-10-01',
    description: 'The Bébé grown up: more power, more wing, a synchronised Vickers. Mount of Nungesser, Guynemer, Ball and Bishop. Superb climb and manoeuvrability; the narrow lower wing dislikes prolonged dives.',
    geometry: geom({ layout: 'sesquiplane', span: 8.16, lowerSpan: 7.8, length: 5.8, chord: 1.2, lowerChord: 0.75, gap: 1.2, stagger: 0.3, height: 2.4, fuselageWidth: 0.72, tailShape: 'comma', fuselageShape: 'round' }),
    performance: perf({ massLoaded: 560, massEmpty: 375, wingArea: 14.75, enginePowerHp: 110, engineType: 'rotary', engineName: 'Le Rhône 9J', maxSpeedKmh: 170, maxSpeedAltM: 2000, ceilingM: 5300, climbTo3000mMin: 11.5, enduranceHours: 2, rollRate: 0.95, pitchRate: 0.9, structuralStrength: 0.6, fuelCapacityL: 75 }),
    guns: [sync('vickers', 0)],
  },
  {
    id: 'sopwith_pup', name: 'Sopwith Pup', shortName: 'Pup', manufacturer: 'Sopwith', nation: 'britain', alsoUsedBy: [],
    role: 'fighter', flyable: true, introduced: '1916-10-01', retired: '1917-12-01',
    description: 'A delightful, light-loading scout: underpowered and lightly armed, yet at altitude it can out-turn an Albatros. McCudden called it the perfect flying machine.',
    geometry: geom({ layout: 'biplane', span: 8.08, lowerSpan: 8.08, length: 5.89, chord: 1.55, gap: 1.35, stagger: 0.45, height: 2.87, fuselageWidth: 0.75, tailShape: 'rounded' }),
    performance: perf({ massLoaded: 556, massEmpty: 358, wingArea: 23.6, enginePowerHp: 80, engineType: 'rotary', engineName: 'Le Rhône 9C', maxSpeedKmh: 179, maxSpeedAltM: 1000, ceilingM: 5334, climbTo3000mMin: 14, enduranceHours: 3, rollRate: 0.85, pitchRate: 0.9, structuralStrength: 0.75, fuelCapacityL: 85 }),
    guns: [sync('vickers', 0)],
  },
  {
    id: 'sopwith_triplane', name: 'Sopwith Triplane', shortName: 'Tripe', manufacturer: 'Sopwith', nation: 'britain', alsoUsedBy: ['france'],
    role: 'fighter', flyable: true, introduced: '1916-12-15', retired: '1917-11-01',
    description: 'The RNAS "Tripehound" climbed so well that it prompted a German triplane craze. Collishaw\'s Black Flight scored 87 victories on it in 1917.',
    geometry: geom({ layout: 'triplane', span: 8.08, middleSpan: 8.08, lowerSpan: 8.08, length: 5.94, chord: 0.99, lowerChord: 0.99, gap: 0.95, stagger: 0.2, height: 3.2, fuselageWidth: 0.75, tailShape: 'rounded', dihedralDeg: 2.5 }),
    performance: perf({ massLoaded: 699, massEmpty: 499, wingArea: 21.46, enginePowerHp: 130, engineType: 'rotary', engineName: 'Clerget 9B', maxSpeedKmh: 187, maxSpeedAltM: 1800, ceilingM: 6250, climbTo3000mMin: 10.5, enduranceHours: 2.75, rollRate: 0.85, pitchRate: 0.85, structuralStrength: 0.7, fuelCapacityL: 85 }),
    guns: [sync('vickers', 0)],
  },
  {
    id: 'spad_vii', name: 'SPAD S.VII', shortName: 'SPAD VII', manufacturer: 'SPAD', nation: 'france', alsoUsedBy: ['britain', 'usa'],
    role: 'fighter', flyable: true, introduced: '1916-09-01', retired: '1918-06-01',
    description: 'Fast, rugged, and a ferocious diver. The SPAD cannot out-turn a Nieuport, but it can choose when to fight and dive away when it chooses not to. Guynemer\'s "Vieux Charles" was a VII.',
    geometry: geom({ layout: 'biplane', span: 7.82, lowerSpan: 7.57, length: 6.08, chord: 1.4, gap: 1.3, stagger: 0.15, height: 2.2, tailShape: 'rounded', fuselageShape: 'round' }),
    performance: perf({ massLoaded: 705, massEmpty: 500, wingArea: 17.85, enginePowerHp: 180, engineType: 'inline', engineName: 'Hispano-Suiza 8Ab', maxSpeedKmh: 208, maxSpeedAltM: 1000, ceilingM: 5500, climbTo3000mMin: 11, enduranceHours: 2.25, rollRate: 0.65, pitchRate: 0.75, structuralStrength: 1.0, fuelCapacityL: 100 }),
    guns: [sync('vickers', 0)],
  },
  {
    id: 'spad_xiii', name: 'SPAD S.XIII', shortName: 'SPAD XIII', manufacturer: 'SPAD', nation: 'france', alsoUsedBy: ['usa', 'britain'],
    role: 'fighter', flyable: true, introduced: '1917-05-01', retired: '1918-11-11',
    description: 'Twin Vickers and 220 horsepower in a tough box of spruce. Fonck, Rickenbacker and Luke flew it. Heavy on the controls; unbeatable in a dive.',
    geometry: geom({ layout: 'biplane', span: 8.25, lowerSpan: 7.9, length: 6.25, chord: 1.45, gap: 1.35, stagger: 0.2, height: 2.6, tailShape: 'rounded', fuselageShape: 'round' }),
    performance: perf({ massLoaded: 845, massEmpty: 566, wingArea: 21.1, enginePowerHp: 220, engineType: 'inline', engineName: 'Hispano-Suiza 8Be', maxSpeedKmh: 218, maxSpeedAltM: 2000, ceilingM: 6650, climbTo3000mMin: 9, enduranceHours: 2, rollRate: 0.65, pitchRate: 0.7, structuralStrength: 1.0, fuelCapacityL: 110 }),
    guns: [sync('vickers', -0.12, 400), sync('vickers', 0.12, 400)],
  },
  {
    id: 'se5a', name: 'Royal Aircraft Factory S.E.5a', shortName: 'S.E.5a', manufacturer: 'Royal Aircraft Factory', nation: 'britain', alsoUsedBy: ['usa'],
    role: 'fighter', flyable: true, introduced: '1917-06-01', retired: '1918-11-11',
    description: 'Stable, strong and fast - "a gun platform" in the words of McCudden and Mannock. A Vickers on the cowl and a Lewis on a Foster mount above the wing. Drums must be changed by hand in the air.',
    geometry: geom({ layout: 'biplane', span: 8.11, lowerSpan: 8.11, length: 6.38, chord: 1.52, gap: 1.4, stagger: 0.45, height: 2.89, tailShape: 'squared', fuselageShape: 'slab', dihedralDeg: 5 }),
    performance: perf({ massLoaded: 902, massEmpty: 639, wingArea: 22.84, enginePowerHp: 200, engineType: 'inline', engineName: 'Wolseley Viper', maxSpeedKmh: 222, maxSpeedAltM: 1000, ceilingM: 5185, climbTo3000mMin: 10.8, enduranceHours: 2.5, rollRate: 0.7, pitchRate: 0.75, structuralStrength: 0.95, fuelCapacityL: 130 }),
    guns: [sync('vickers', -0.15, 400), overwingLewis(1.65, -0.8)],
  },
  {
    id: 'sopwith_camel', name: 'Sopwith F.1 Camel', shortName: 'Camel', manufacturer: 'Sopwith', nation: 'britain', alsoUsedBy: ['usa'],
    role: 'fighter', flyable: true, introduced: '1917-06-15', retired: '1918-11-11',
    description: 'Credited with more victories than any other Allied type - and it killed many of its own novices. Engine, guns, pilot and fuel are packed into the first seven feet, and the Clerget\'s torque snaps it into a right turn faster than anything alive. Turn left with care.',
    geometry: geom({ layout: 'biplane', span: 8.53, lowerSpan: 8.53, length: 5.71, chord: 1.37, gap: 1.52, stagger: 0.46, height: 2.6, tailShape: 'rounded', dihedralDeg: 2.5 }),
    performance: perf({ massLoaded: 659, massEmpty: 420, wingArea: 21.46, enginePowerHp: 130, engineType: 'rotary', engineName: 'Clerget 9B', maxSpeedKmh: 185, maxSpeedAltM: 1000, ceilingM: 5800, climbTo3000mMin: 10, enduranceHours: 2.5, rollRate: 1.0, pitchRate: 1.0, structuralStrength: 0.8, fuelCapacityL: 70 }),
    guns: [sync('vickers', -0.12, 250), sync('vickers', 0.12, 250)],
  },
  {
    id: 'nieuport_28', name: 'Nieuport 28', shortName: 'N.28', manufacturer: 'Nieuport', nation: 'usa', alsoUsedBy: ['france'],
    role: 'fighter', flyable: true, introduced: '1918-03-01', retired: '1918-08-01',
    description: 'The first fighter flown by the American Expeditionary Force - Rickenbacker scored his first victories in one. Graceful and quick, but its fabric is known to strip from the upper wing in a dive.',
    geometry: geom({ layout: 'biplane', span: 8.16, lowerSpan: 7.7, length: 6.2, chord: 1.2, lowerChord: 1.0, gap: 1.2, stagger: 0.25, height: 2.48, fuselageWidth: 0.72, fuselageShape: 'round', tailShape: 'comma' }),
    performance: perf({ massLoaded: 698, massEmpty: 460, wingArea: 20.0, enginePowerHp: 160, engineType: 'rotary', engineName: 'Gnome 9N', maxSpeedKmh: 196, maxSpeedAltM: 1000, ceilingM: 5200, climbTo3000mMin: 11, enduranceHours: 1.75, rollRate: 0.9, pitchRate: 0.9, structuralStrength: 0.6, fuelCapacityL: 90 }),
    guns: [sync('vickers', -0.12, 500), sync('vickers', 0.12, 500)],
  },
  {
    id: 'bristol_f2b', name: 'Bristol F.2b Fighter', shortName: 'Brisfit', manufacturer: 'Bristol', nation: 'britain', alsoUsedBy: [],
    role: 'two-seater', flyable: true, introduced: '1917-04-01', retired: '1918-11-11',
    description: 'A two-seater flown like a single-seat fighter: a forward Vickers for the pilot and a Lewis for the observer. Once crews stopped flying it defensively, it became one of the best aircraft of the war.',
    geometry: geom({ layout: 'biplane', span: 11.96, lowerSpan: 11.96, length: 7.87, chord: 1.7, gap: 1.65, stagger: 0.3, height: 2.97, crew: 2, tailShape: 'squared', fuselageWidth: 0.9, wheelTrack: 2.0 }),
    performance: perf({ massLoaded: 1474, massEmpty: 975, wingArea: 37.62, enginePowerHp: 275, engineType: 'inline', engineName: 'Rolls-Royce Falcon III', maxSpeedKmh: 198, maxSpeedAltM: 1000, ceilingM: 5500, climbTo3000mMin: 11.5, enduranceHours: 3, rollRate: 0.6, pitchRate: 0.65, structuralStrength: 1.0, fuelCapacityL: 200 }),
    guns: [sync('vickers', 0), rearGun('lewis')],
  },
  {
    id: 're8', name: 'Royal Aircraft Factory R.E.8', shortName: 'R.E.8', manufacturer: 'Royal Aircraft Factory', nation: 'britain', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1916-11-01', retired: '1918-11-11',
    description: 'The "Harry Tate": the standard British artillery-spotting and reconnaissance two-seater. Stable, slow and a frequent customer for German scouts.',
    geometry: geom({ layout: 'biplane', span: 12.98, lowerSpan: 10.8, length: 8.5, chord: 1.7, gap: 1.8, stagger: 0.3, height: 3.47, crew: 2, tailShape: 'squared', fuselageWidth: 0.95, wheelTrack: 2.1 }),
    performance: perf({ massLoaded: 1301, massEmpty: 717, wingArea: 35.07, enginePowerHp: 150, engineType: 'inline', engineName: 'RAF 4a', maxSpeedKmh: 164, maxSpeedAltM: 0, ceilingM: 4115, climbTo3000mMin: 22, enduranceHours: 4.25, rollRate: 0.45, pitchRate: 0.5, structuralStrength: 0.8, fuelCapacityL: 200 }),
    guns: [sync('vickers', 0), rearGun('lewis')],
  },
  {
    id: 'dh4', name: 'Airco D.H.4', shortName: 'D.H.4', manufacturer: 'Airco', nation: 'britain', alsoUsedBy: ['usa'],
    role: 'bomber', flyable: false, introduced: '1917-03-01', retired: '1918-11-11',
    description: 'A fast day bomber, able to outrun many German scouts with its Rolls-Royce Eagle. The fuel tank between pilot and observer earned it a grim nickname.',
    geometry: geom({ layout: 'biplane', span: 12.92, lowerSpan: 12.92, length: 9.35, chord: 1.7, gap: 1.75, stagger: 0.3, height: 3.35, crew: 2, tailShape: 'squared', fuselageWidth: 0.95, wheelTrack: 2.2 }),
    performance: perf({ massLoaded: 1575, massEmpty: 1083, wingArea: 40.32, enginePowerHp: 375, engineType: 'inline', engineName: 'Rolls-Royce Eagle VIII', maxSpeedKmh: 230, maxSpeedAltM: 1000, ceilingM: 6700, climbTo3000mMin: 11, enduranceHours: 3.75, rollRate: 0.45, pitchRate: 0.5, structuralStrength: 0.85, fuelCapacityL: 300 }),
    guns: [sync('vickers', 0), rearGun('lewis')],
  },
  {
    id: 'be2c', name: 'Royal Aircraft Factory B.E.2c', shortName: 'B.E.2c', manufacturer: 'Royal Aircraft Factory', nation: 'britain', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1915-04-01', retired: '1917-06-01',
    description: 'The "Quirk": built to be inherently stable for reconnaissance, it was easy meat for the Fokker monoplanes. The observer sits in front, under the upper wing, hemmed in by struts, wires and the propeller.',
    geometry: geom({ layout: 'biplane', span: 11.28, lowerSpan: 10.7, length: 8.31, chord: 1.68, gap: 1.9, stagger: 0.6, height: 3.39, dihedralDeg: 3.5, crew: 2, tailShape: 'rounded', fuselageWidth: 0.85, wheelTrack: 1.9 }),
    performance: perf({ massLoaded: 972, massEmpty: 623, wingArea: 34.8, enginePowerHp: 90, engineType: 'inline', engineName: 'RAF 1a', maxSpeedKmh: 116, maxSpeedAltM: 1000, ceilingM: 3400, climbTo3000mMin: 40, enduranceHours: 3.25, rollRate: 0.35, pitchRate: 0.45, structuralStrength: 0.7, fuelCapacityL: 145 }),
    guns: [frontGun([0, 0.9, -1.0])],
  },
  {
    id: 'fe2b', name: 'Royal Aircraft Factory F.E.2b', shortName: 'F.E.2b', manufacturer: 'Royal Aircraft Factory', nation: 'britain', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1916-01-01', retired: '1917-08-01',
    description: 'A big pusher fighter-reconnaissance machine. The observer stands in the open nose with a Lewis gun and a clear field of fire forward; behind him the pilot, and behind them both the Beardmore engine. Formations of them fought back hard in circles.',
    geometry: geom({ layout: 'biplane', pusher: true, span: 14.55, lowerSpan: 14.55, length: 9.83, chord: 1.68, gap: 1.83, stagger: 0, height: 3.85, dihedralDeg: 3, crew: 2, tailShape: 'rounded', fuselageWidth: 0.9, wheelTrack: 2.2 }),
    performance: perf({ massLoaded: 1378, massEmpty: 935, wingArea: 45.9, enginePowerHp: 160, engineType: 'inline', engineName: 'Beardmore 160 hp', maxSpeedKmh: 147, maxSpeedAltM: 0, ceilingM: 3350, climbTo3000mMin: 38, enduranceHours: 2.5, rollRate: 0.35, pitchRate: 0.45, structuralStrength: 0.8, fuelCapacityL: 180 }),
    guns: [frontGun([0, 0.7, -2.6])],
  },
  {
    id: 'farman_f40', name: 'Farman F.40', shortName: 'F.40', manufacturer: 'Farman', nation: 'france', alsoUsedBy: [],
    role: 'two-seater', flyable: false, introduced: '1915-09-01', retired: '1917-03-01',
    description: 'The "Horace", mainstay of French reconnaissance and artillery observation into 1916. A pusher with a wide upper wing and its tail carried on booms; the observer rides in the nose with a Lewis gun.',
    geometry: geom({ layout: 'biplane', pusher: true, span: 17.6, lowerSpan: 12.5, length: 9.25, chord: 2.0, gap: 2.0, stagger: 0, height: 3.9, dihedralDeg: 1, crew: 2, tailShape: 'squared', fuselageWidth: 0.85, wheelTrack: 2.2 }),
    performance: perf({ massLoaded: 1120, massEmpty: 750, wingArea: 52, enginePowerHp: 130, engineType: 'inline', engineName: 'Renault 8C', maxSpeedKmh: 135, maxSpeedAltM: 0, ceilingM: 4000, climbTo3000mMin: 42, enduranceHours: 2.3, rollRate: 0.3, pitchRate: 0.4, structuralStrength: 0.7, fuelCapacityL: 140 }),
    guns: [frontGun([0, 0.7, -2.6])],
  },
];

export const AIRCRAFT: Readonly<Record<AircraftId, AircraftSpec>> = Object.fromEntries(SPECS.map((s) => [s.id, s])) as Record<AircraftId, AircraftSpec>;

export const AIRCRAFT_LIST: readonly AircraftSpec[] = SPECS;

export function getAircraft(id: AircraftId): AircraftSpec {
  const s = AIRCRAFT[id];
  if (!s) throw new Error(`Unknown aircraft ${id}`);
  return s;
}

/** Aircraft in front-line service on `date` for `side`. */
export function aircraftInService(date: string, side?: 'central' | 'allied'): AircraftSpec[] {
  return SPECS.filter(
    (s) => s.introduced <= date && date <= s.retired && (!side || (side === 'central') === (s.nation === 'germany')),
  );
}
