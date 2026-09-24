import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { getCoefficients, maxLevelSpeed } from './coefficients';

describe('coefficient calibration (point mass)', () => {
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
      if (Math.abs(vmax / p.maxSpeedKmh - 1) > 0.03) errs.push(`${spec.id} vmax`);
      if (Math.abs(co.predicted.timeTo3000Min / p.climbTo3000mMin - 1) > 0.1) errs.push(`${spec.id} climb`);
      if (Math.abs(co.predicted.ceilingM / p.ceilingM - 1) > 0.1) errs.push(`${spec.id} ceiling`);
    }
    console.log(rows.join('\n'));
    expect(errs).toEqual([]);
  });
});
