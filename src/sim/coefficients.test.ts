import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST, getAircraft } from '../data/aircraft';
import { calibrationProblems, getCoefficients, maxLevelSpeed } from './coefficients';

describe('coefficient calibration (point mass)', () => {
  it.each([false, true])('keeps same-id specs independent (variant first: %s)', (variantFirst) => {
    const original = { ...getAircraft('sopwith_camel') };
    const variant = { ...original, performance: { ...original.performance, massLoaded: original.performance.massLoaded * 1.1 } };
    const specs = variantFirst ? [variant, original] : [original, variant];
    for (const spec of specs) expect(getCoefficients(spec).mass).toBe(spec.performance.massLoaded);
    for (const spec of specs) {
      const co = getCoefficients(spec);
      expect(co.mass).toBe(spec.performance.massLoaded);
      expect(getCoefficients(spec)).toBe(co);
    }
  });

  it('sizes each twin propeller for its own engine rather than the combined power', () => {
    for (const id of ['gotha_gv', 'handley_page_o400', 'aeg_giv'] as const) {
      const twin = getAircraft(id);
      const engines = twin.performance.engineCount!;
      const oneEngine = {
        ...twin,
        performance: { ...twin.performance, engineCount: 1, enginePowerHp: twin.performance.enginePowerHp / engines },
      };
      // Adding identical engines adds discs, not diameter to each disc.
      expect(getCoefficients(twin).propDiscArea / engines).toBeCloseTo(getCoefficients(oneEngine).propDiscArea, 8);
    }
  });

  it('reports the coupled deviation and saturated lapse bound for the rejected 52 min Voisin estimate', () => {
    const shipped = getAircraft('voisin_iii');
    const impossible = { ...shipped, performance: { ...shipped.performance, climbTo3000mMin: 52 } };
    const co = getCoefficients(impossible);
    const speed = maxLevelSpeed(co, impossible.performance.maxSpeedAltM) * 3.6;
    const problems = calibrationProblems(impossible);
    expect(shipped.performance.climbTo3000mMin).toBe(45);
    expect(calibrationProblems(shipped)).toEqual([]);
    expect(problems).toHaveLength(1);
    const detail = problems[0];
    expect(detail).toContain('voisin_iii');
    expect(detail).toContain(`speed requested ${shipped.performance.maxSpeedKmh.toFixed(2)} km/h, achieved ${speed.toFixed(2)} km/h`);
    expect(detail).toContain(`climb requested 52.00 min, achieved ${co.predicted.timeTo3000Min.toFixed(2)} min`);
    expect(detail).toContain(`ceiling requested ${shipped.performance.ceilingM.toFixed(2)} m, achieved ${co.predicted.ceilingM.toFixed(2)} m`);
    expect(co.lapseN).toBeCloseTo(0.55, 7);
    expect(detail).toContain('lapseN 0.550000 in [0.55, 2.6] (lower bound saturated)');
    expect(detail).toContain(`propDesignV/vMax ${(co.propDesignV / co.vMax).toFixed(6)} in [0.6, 1.8]`);
    // Compare the reported failure against real performance, not a synthetic diagnostic fixture.
    const climbDeviation = co.predicted.timeTo3000Min / 52 - 1;
    const ceilingDeviation = co.predicted.ceilingM / shipped.performance.ceilingM - 1;
    expect(Math.max(Math.abs(climbDeviation), Math.abs(ceilingDeviation))).toBeGreaterThan(0.1);
    expect(detail).toContain(`${(climbDeviation * 100).toFixed(2)}% deviation, tolerance ±10%`);
    expect(detail).toContain(`${(ceilingDeviation * 100).toFixed(2)}% deviation, tolerance ±10%`);
    expect(detail).toContain('Check physically consistent source figures and loaded mass; do not widen test tolerances.');
    expect(calibrationProblems(impossible)).toEqual(problems);
    expect(getCoefficients(impossible)).toBe(co);
  });

  it('matches historical figures for every aircraft', () => {
    const rows: string[] = [];
    const errs: string[] = [];
    for (const spec of AIRCRAFT_LIST) {
      const co = getCoefficients(spec);
      const p = spec.performance;
      const vmax = maxLevelSpeed(co, p.maxSpeedAltM) * 3.6;
      rows.push(
        `${spec.id.padEnd(18)} vmax ${vmax.toFixed(0)}/${p.maxSpeedKmh}  climb ${co.predicted.timeTo3000Min.toFixed(1)}/${p.climbTo3000mMin}  ceil ${co.predicted.ceilingM.toFixed(0)}/${p.ceilingM}  cd0 ${co.cd0.toFixed(4)} vd ${(co.propDesignV / co.vMax).toFixed(2)} n ${co.lapseN.toFixed(2)} vs ${(co.vStallSL * 3.6).toFixed(0)} vy ${(co.vBestClimbSL * 3.6).toFixed(0)}`,
      );
      errs.push(...calibrationProblems(spec));
    }
    console.log(rows.join('\n'));
    expect(errs).toEqual([]);
  });
});
