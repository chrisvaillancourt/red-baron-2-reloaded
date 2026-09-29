import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_LIST, PUSHER_NOSE_ARCS, REAR_RING_ARCS } from './aircraft';
import { crewStations, NOSE_GUNNER_ARCS, REAR_OBSERVER_ARCS, stationEye } from './crew';

const BOMBERS = ['gotha_gv', 'aeg_giv', 'handley_page_o400', 'breguet_14b2', 'dh9', 'voisin_iii', 'dh4'] as const;

describe('aircraft roster', () => {
  it('keeps its copy of the pusher nose-gunner arcs equal to crew.ts', () => {
    expect(PUSHER_NOSE_ARCS).toEqual(NOSE_GUNNER_ARCS);
  });

  it('keeps its copy of the rear observer arcs equal to crew.ts', () => {
    expect(REAR_RING_ARCS).toEqual(REAR_OBSERVER_ARCS);
  });

  it('puts the eye of a twin-gun station on the centre line between its guns', () => {
    for (const spec of AIRCRAFT_LIST)
      for (const s of crewStations(spec)) {
        const eye = stationEye(spec, s);
        if (!eye || s.guns.length < 2) continue;
        const xs = s.guns.map((g) => spec.guns[g].position[0]);
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        expect([spec.id, s.id, eye[0]]).toEqual([spec.id, s.id, mid]);
      }
  });

  it('mans every crew member from some station', () => {
    for (const spec of AIRCRAFT_LIST) {
      const used = new Set(crewStations(spec).map((s) => s.crewIndex));
      // A two-seater without a flexible gun would leave its observer stationless; none does.
      expect([spec.id, used.size]).toEqual([spec.id, spec.geometry.crew]);
    }
  });

  it('gives the bombers a bomb load their loaded weight can carry, and a bomb aimer', () => {
    for (const id of BOMBERS) {
      const spec = AIRCRAFT[id];
      expect(spec.role).toBe('bomber');
      const load = spec.bombs!.reduce((m, b) => m + b.massKg * b.count, 0);
      expect(load).toBeGreaterThan(0);
      // Loaded weight includes the bombs, fuel and crew on top of the empty weight.
      expect(load).toBeLessThan(spec.performance.massLoaded - spec.performance.massEmpty);
      for (const b of spec.bombs!) expect(b.explosiveKg).toBeLessThan(b.massKg);
      expect(crewStations(spec).filter((s) => s.bombAimer)).toHaveLength(1);
    }
  });

  it('places twin engines off the centre line, clear of the fuselage', () => {
    for (const spec of AIRCRAFT_LIST) {
      const n = spec.performance.engineCount ?? 1;
      if (n === 1) {
        expect(spec.geometry.nacelleOffsetX ?? 0).toBe(0);
        continue;
      }
      expect(n).toBe(2);
      expect(spec.geometry.nacelleOffsetX!).toBeGreaterThan(spec.geometry.fuselageWidth);
      expect(spec.geometry.nacelleOffsetX!).toBeLessThan(spec.geometry.lowerSpan / 2);
    }
  });

  it('gives the Gotha one rear gunner for the dorsal and tunnel guns', () => {
    const st = crewStations(AIRCRAFT.gotha_gv);
    expect(st.map((s) => s.id)).toEqual(['pilot', 'nose', 'dorsal', 'ventral']);
    const dorsal = st.find((s) => s.id === 'dorsal')!;
    const ventral = st.find((s) => s.id === 'ventral')!;
    expect(ventral.crewIndex).toBe(dorsal.crewIndex);
    expect(st.find((s) => s.bombAimer)?.id).toBe('nose');
  });

  it('arms the Voisin III with a strip-fed Hotchkiss', () => {
    expect(AIRCRAFT.voisin_iii.guns.map((g) => [g.type, g.rounds])).toEqual([['hotchkiss', 25]]);
  });
});
