import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AircraftEntity, AircraftSpec } from '../core/types';
import { aimFlexibleGun } from '../sim/combat';
import { AIRCRAFT } from './aircraft';
import { bodyDirectionAngles, crewStationProblems, crewStations, inFireArcs, stationEye, stationForGun } from './crew';

describe('crewStations', () => {
  it('gives a single-seater only the pilot, with every gun', () => {
    const st = crewStations(AIRCRAFT.sopwith_camel);
    expect(st.map((s) => s.id)).toEqual(['pilot']);
    expect(st[0].guns).toEqual([0, 1]);
    expect(st[0].arcs).toEqual([]);
  });

  it('gives a two-seater a pilot with the fixed guns and an observer with the flexible one', () => {
    const st = crewStations(AIRCRAFT.bristol_f2b);
    expect(st.map((s) => [s.id, s.crewIndex, s.guns])).toEqual([
      ['pilot', 0, [0]],
      ['observer', 1, [1]],
    ]);
    expect(st[1].arcs.length).toBeGreaterThan(0);
    expect(stationForGun(AIRCRAFT.bristol_f2b, 1)?.id).toBe('observer');
  });

  it('calls a pusher nose gunner a nose gunner, and a B.E.2c front observer an observer', () => {
    expect(crewStations(AIRCRAFT.fe2b)[1].label).toBe('Nose gunner');
    expect(crewStations(AIRCRAFT.be2c)[1].label).toBe('Observer');
  });

  it('makes the observer the bomb aimer when the type carries bombs', () => {
    const st = crewStations(AIRCRAFT.dh4);
    expect(AIRCRAFT.dh4.bombs?.length).toBeGreaterThan(0);
    expect(st.filter((s) => s.bombAimer).map((s) => s.id)).toEqual(['observer']);
  });

  it('prefers the stations a spec lists', () => {
    const spec: AircraftSpec = {
      ...AIRCRAFT.bristol_f2b,
      crewStations: [
        { id: 'pilot', label: 'Pilot', crewIndex: 0, guns: [0], arcs: [] },
        { id: 'rear', label: 'Rear gunner', crewIndex: 1, guns: [1], arcs: [{ azimuthDeg: [90, -90], elevationDeg: [0, 90] }] },
      ],
    };
    expect(crewStations(spec).map((s) => s.id)).toEqual(['pilot', 'rear']);
  });

  it('finds no problems in any aircraft in the roster', () => {
    for (const spec of Object.values(AIRCRAFT)) expect([spec.id, crewStationProblems(spec)]).toEqual([spec.id, []]);
  });

  it('reports a gun worked from two stations and a crew index past the crew', () => {
    const spec: AircraftSpec = {
      ...AIRCRAFT.bristol_f2b,
      crewStations: [
        { id: 'pilot', label: 'Pilot', crewIndex: 0, guns: [0, 1], arcs: [] },
        { id: 'rear', label: 'Rear gunner', crewIndex: 2, guns: [1], arcs: [{ azimuthDeg: [90, -90], elevationDeg: [0, 90] }] },
      ],
    };
    const problems = crewStationProblems(spec).join('; ');
    expect(problems).toMatch(/gun 1 worked from pilot and rear/);
    expect(problems).toMatch(/crew index 2 outside a crew of 2/);
  });
});

describe('stationEye', () => {
  it('sits a gunner above and behind his gun, and leaves the pilot to the model', () => {
    const spec = AIRCRAFT.bristol_f2b;
    const [pilot, observer] = crewStations(spec);
    const gun = spec.guns[1].position;
    expect(stationEye(spec, observer)).toEqual([gun[0], gun[1] + 0.45, gun[2] + 0.35]);
    expect(stationEye(spec, pilot)).toBeNull();
  });
});

describe('inFireArcs', () => {
  it('measures azimuth clockwise from the nose and elevation from the wings', () => {
    expect(bodyDirectionAngles(0, 0, -1)).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
    expect(bodyDirectionAngles(1, 0, 0).azimuthDeg).toBeCloseTo(90);
    expect(bodyDirectionAngles(-1, 0, 0).azimuthDeg).toBeCloseTo(-90);
    expect(Math.abs(bodyDirectionAngles(0, 0, 1).azimuthDeg)).toBeCloseTo(180);
    expect(bodyDirectionAngles(0, 1, -1).elevationDeg).toBeCloseTo(45);
  });

  it('wraps an arc through astern', () => {
    const tail = [{ azimuthDeg: [150, -150] as [number, number], elevationDeg: [-10, 10] as [number, number] }];
    expect(inFireArcs(tail, 0, 0, 1)).toBe(true); // dead astern
    expect(inFireArcs(tail, 0.3, 0, 1)).toBe(true); // ~17° right of astern
    expect(inFireArcs(tail, 1, 0, 0)).toBe(false); // abeam
    expect(inFireArcs(tail, 0, 0.5, 1)).toBe(false); // too high
  });

  it('covers straight up with any arc that reaches +90°', () => {
    expect(inFireArcs([{ azimuthDeg: [90, 100], elevationDeg: [80, 90] }], 0, 1, 0)).toBe(true);
  });

  // The derived arcs stand in for the old hard-coded field of fire in src/sim/combat.ts.
  // Agreement over the sphere, weighted by solid angle, shows they are the same shape.
  for (const id of ['bristol_f2b', 'fe2b'] as const) {
    it(`matches the combat field of fire for the ${id}`, () => {
      const spec = AIRCRAFT[id];
      const observer = crewStations(spec)[1];
      const mount = crewStations(spec)[1].guns[0];
      const ac = { spec, state: { position: new Vector3(), orientation: new Quaternion() } } as unknown as AircraftEntity;
      const muzzle = new Vector3(...spec.guns[mount].position);
      let agree = 0;
      let total = 0;
      for (let el = -87.5; el < 90; el += 5) {
        for (let az = -177.5; az < 180; az += 5) {
          const e = (el * Math.PI) / 180;
          const a = (az * Math.PI) / 180;
          const dir = new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
          const sim = aimFlexibleGun(ac, mount, muzzle.clone().addScaledVector(dir, 300)).inArc;
          const w = Math.cos(e);
          total += w;
          if (sim === inFireArcs(observer.arcs, dir.x, dir.y, dir.z)) agree += w;
        }
      }
      expect(agree / total).toBeGreaterThan(0.97);
    });
  }
});
