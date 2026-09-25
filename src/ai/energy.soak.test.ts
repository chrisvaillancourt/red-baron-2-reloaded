/**
 * Dive-and-zoom energy probe (AI_SOAK=energy): does a heavier fighter out-dive and
 * out-zoom a lighter one on the real flight model? Each type starts level at 2,500 m and
 * cruise speed, dives at 40° under full throttle for `AI_EN_DIVE` s (governed by the
 * autopilot's structural dive limit, as the AI flies), then zooms at 35° until it slows
 * to 1.3 Vs. Reports top speed, height lost, height regained and net height change.
 *
 *   AI_SOAK=energy pnpm vitest run src/ai/energy.soak.test.ts
 */
import { describe, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftId } from '../core/types';
import type { SteerCommand } from './autopilot';
import { SimWorld } from './testing/realSimHarness';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const DIVE_S = Number(process.env.AI_EN_DIVE ?? 12);
const TYPES = (process.env.AI_EN_TYPES ?? 'albatros_dv,sopwith_camel,fokker_dri,spad_xiii,fokker_dvii,se5a,pfalz_diiia').split(',') as AircraftId[];

describe.skipIf(!SOAK.includes('energy'))('dive and zoom energy', () => {
  it('reports height regained per type', () => {
    const lines = ['type | top speed m/s | lowest m | zoom top m | net m | zoom s'];
    for (const id of TYPES) {
      const w = new SimWorld({ ground: () => 50 });
      const ac = w.addAircraft({ aircraftId: id, side: 'allied', x: 0, z: 0, alt: 2500, heading: 0, speed: 0 });
      const ctl = w.addAI(ac, 'veteran');
      ac.state.velocity.set(0, 0, -ctl.traits.cruiseSpeed);
      const steer: SteerCommand = { dir: new Vector3(), speed: Infinity, maxG: 4 };
      let t = 0;
      let top = 0;
      let low = Infinity;
      let high = -Infinity;
      let zoomStart = -1;
      let zoomEnd = -1;
      for (let k = 0; k < 120 * 60; k++) {
        if (k % 4 === 0) {
          const v = ac.state.velocity;
          const fh = new Vector3(v.x, 0, v.z).normalize();
          if (t < DIVE_S) steer.dir.copy(fh).multiplyScalar(Math.cos(0.7)).setY(-Math.sin(0.7));
          else steer.dir.copy(fh).multiplyScalar(Math.cos(0.61)).setY(Math.sin(0.61));
          ctl.autopilot.fly(ac, steer, w, 4 / 120);
        }
        w.step(false, 0);
        t = w.time;
        const s = ac.state;
        top = Math.max(top, s.airspeed);
        if (t < DIVE_S + 1) low = Math.min(low, s.position.y);
        if (t >= DIVE_S) {
          if (zoomStart < 0) zoomStart = t;
          high = Math.max(high, s.position.y);
          if (s.airspeed < ctl.traits.stallSpeed * 1.3 && t > DIVE_S + 2) {
            zoomEnd = t;
            break;
          }
        }
        if (ac.outcome || ac.damage.structuralFailure) break;
      }
      lines.push([id.padEnd(14), top.toFixed(0), low.toFixed(0), high.toFixed(0), (high - 2500).toFixed(0), zoomEnd > 0 ? (zoomEnd - zoomStart).toFixed(1) : '-', ac.damage.structuralFailure ? 'STRUCTURAL' : ''].join(' | '));
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 600_000);
});
