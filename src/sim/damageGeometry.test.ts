import { describe, expect, it } from 'vitest';
import type { AircraftSpec } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { crewStations } from '../data/crew';
import { getHitModel, traceRound, type ZoneBox } from './hitboxes';
import { loadModelGeometry } from './testing/modelGeometry';


const across = (spec: AircraftSpec, y: number, z: number, occupied: (box: ZoneBox) => boolean = () => true) =>
  traceRound(getHitModel(spec), { x: -spec.geometry.span, y, z }, { x: spec.geometry.span, y, z }, occupied, true);

for (const id of ['gotha_gv', 'handley_page_o400', 'aeg_giv'] as const) {
  describe(`${id} shipped damage geometry`, () => {
    const spec = getAircraft(id);
    const { bounds } = loadModelGeometry(id);

    it('hits each nacelle core with its engine index, not the empty old engine volume', () => {
      for (const [index, side] of ['L', 'R'].entries()) {
        const shell = bounds(`Engine_${side}`, 'Livery_Cowling');
        const x = (shell.min[0] + shell.max[0]) / 2;
        const y = (shell.min[1] + shell.max[1]) / 2;
        // Independent measured longitudinal points throughout the cowling, not the old wing-edge heuristic.
        for (const fraction of [0.25, 0.5, 0.75]) {
          const z = shell.min[2] + fraction * (shell.max[2] - shell.min[2]);
          const trace = traceRound(getHitModel(spec), { x, y: -5, z }, { x, y: 5, z }, () => true, true);
          expect(trace?.damaged.filter((h) => h.zone === 'engine').map((h) => h.index)).toEqual([index]);
        }
        // Ahead of the measured nacelle and below its cowling is empty engine space.
        const oldEmpty = traceRound(getHitModel(spec), { x, y: -0.55, z: shell.min[2] - 0.2 }, { x, y: -0.55, z: shell.min[2] - 0.1 }, () => true, true);
        expect(oldEmpty?.crossed.filter((h) => h.zone === 'engine') ?? []).toEqual([]);
        const engine = getHitModel(spec).zones.find((b) => b.engineIndex === index)!;
        // The damage box surrounds the nacelle shell, not the tall wing-support metal primitive.
        for (const axis of [0, 1, 2]) {
          expect(Math.abs(engine.min[axis] - shell.min[axis])).toBeLessThan(0.1);
          expect(Math.abs(engine.max[axis] - shell.max[axis])).toBeLessThan(0.1);
        }
        expect(across(spec, y, (shell.min[2] + shell.max[2]) / 2)?.damaged.filter((h) => h.zone === 'engine').map((h) => h.index)).toEqual([0]);
      }
    });

    if (id !== 'aeg_giv') {
      it('keeps the whole prone gunner within the fuselage envelope and stops phantom wounds below it', () => {
        const fuselage = bounds('Fuselage');
        const ventral = getHitModel(spec).zones.find((b) => b.station === 'ventral')!;
        for (const axis of [0, 1, 2]) {
          expect(ventral.min[axis]).toBeGreaterThanOrEqual(fuselage.min[axis] - 0.001);
          expect(ventral.max[axis]).toBeLessThanOrEqual(fuselage.max[axis] + 0.001);
        }
        const station = crewStations(spec).find((s) => s.id === 'ventral')!;
        const occupied = (b: ZoneBox) => !b.station || b.station === station.id;
        const [x, y, z] = station.eye!;
        expect(x).toBe(0);
        expect(across(spec, y + 0.3, z, occupied)?.damaged.filter((h) => h.zone === 'gunner').map((h) => h.index)).toEqual([station.crewIndex]);
        expect(across(spec, fuselage.min[1] - 0.5, z, occupied)).toBeNull();
      });
    }
  });
}

it('only wounds the Gotha rear crew member at the station he currently occupies', () => {
  const spec = getAircraft('gotha_gv');
  const dorsal = crewStations(spec).find((s) => s.id === 'dorsal')!;
  const ventral = crewStations(spec).find((s) => s.id === 'ventral')!;
  expect(dorsal.crewIndex).toBe(ventral.crewIndex);
  for (const active of [dorsal, ventral]) {
    for (const target of [dorsal, ventral]) {
      const [, y, z] = target.eye!;
      const trace = across(spec, y + (target.posture === 'prone' ? 0.3 : -0.3), z, (b) => !b.station || b.crewIndex !== active.crewIndex || b.station === active.id);
      expect(trace?.damaged.filter((h) => h.zone === 'gunner').map((h) => h.index) ?? []).toEqual(active === target ? [active.crewIndex] : []);
    }
  }
});
