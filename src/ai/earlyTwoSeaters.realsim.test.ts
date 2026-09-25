/**
 * The early-war two-seaters (B.E.2c, F.E.2b, Farman F.40, Albatros C.III) on the real flight
 * model and combat: they cruise level and trimmed under the AI, and their observers fire.
 */
import { describe, expect, it } from 'vitest';
import type { AircraftId, Waypoint } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { runSim, SimWorld } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';

const TYPES: AircraftId[] = ['be2c', 'fe2b', 'farman_f40', 'albatros_ciii'];
const sideOf = (id: AircraftId) => (getAircraft(id).nation === 'germany' ? 'central' : 'allied');

describe('early-war two-seaters on the real flight model', { timeout: 60_000 }, () => {
  it('each cruises level and trimmed on a recon route', () => {
    for (const id of TYPES) {
      const side = sideOf(id);
      const wps: Waypoint[] = [{ x: 0, z: -30000, altitude: 1500, action: 'fly' }];
      const world = new SimWorld({ flights: [routeFlight('r', side, id, wps, { task: 'recon' })], frontX: side === 'allied' ? 1e9 : -1e9 });
      const ac = world.addAircraft({ aircraftId: id, side, x: 0, z: 0, alt: 1500, heading: 0, flightId: 'r' });
      world.addAI(ac, 'regular', { task: 'recon' });
      let t = 0;
      let n = 0;
      let pitchSum = 0;
      let pitchSq = 0;
      let minAlt = Infinity;
      let maxAlt = -Infinity;
      runSim(world, 150, {
        onStep: () => {
          t += 1 / 120;
          if (t < 30) return; // settle
          const y = ac.state.position.y;
          minAlt = Math.min(minAlt, y);
          maxAlt = Math.max(maxAlt, y);
          pitchSum += ac.controls.pitch;
          pitchSq += ac.controls.pitch ** 2;
          n++;
        },
      });
      const mean = pitchSum / n;
      const sd = Math.sqrt(Math.max(0, pitchSq / n - mean * mean));
      expect(ac.outcome, id).toBeNull();
      expect(ac.state.stalled, id).toBe(false);
      expect(maxAlt - minAlt, `${id} height band`).toBeLessThan(120);
      expect(Math.abs(mean), `${id} mean elevator`).toBeLessThan(0.5);
      expect(sd, `${id} elevator activity`).toBeLessThan(0.15);
      expect(ac.state.airspeed * 3.6, `${id} cruise speed`).toBeGreaterThan(getAircraft(id).performance.maxSpeedKmh * 0.6);
    }
  });

  it('observers engage: F.E.2b and Farman nose gunners ahead, B.E.2c and C.III against a tail attacker', () => {
    const cases: { id: AircraftId; enemy: AircraftId; ahead: boolean }[] = [
      { id: 'fe2b', enemy: 'fokker_eiii', ahead: true },
      { id: 'farman_f40', enemy: 'fokker_eiii', ahead: true },
      { id: 'be2c', enemy: 'fokker_eiii', ahead: false },
      { id: 'albatros_ciii', enemy: 'airco_dh2', ahead: false },
    ];
    for (const c of cases) {
      let shots = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const side = sideOf(c.id);
        const enemySide = side === 'allied' ? 'central' : 'allied';
        const wps: Waypoint[] = [{ x: 0, z: -30000, altitude: 1500, action: 'fly' }];
        const world = new SimWorld({ flights: [routeFlight('r', side, c.id, wps, { task: 'recon' })], frontX: 1e9, seed });
        const me = world.addAircraft({ aircraftId: c.id, side, x: 0, z: 0, alt: 1500, heading: 0, flightId: 'r', skill: 'regular' });
        // Head-on from ahead, or sitting on the tail slightly high.
        const att = c.ahead
          ? world.addAircraft({ aircraftId: c.enemy, side: enemySide, x: 20, z: -900, alt: 1520, heading: Math.PI, flightId: 'h', skill: 'novice' })
          : world.addAircraft({ aircraftId: c.enemy, side: enemySide, x: 30, z: 450, alt: 1540, heading: 0, flightId: 'h', skill: 'novice' });
        world.addAI(me, 'regular', { task: 'recon', seed });
        world.addAI(att, 'novice', { seed: seed + 10 });
        runSim(world, 60, { onStep: () => !!att.outcome || !!me.outcome });
        const flex = me.spec.guns.find((g) => g.mount === 'flexible')!.type;
        shots += world.eventsOf('gun-fired').filter((e) => e.shooterId === me.id && e.gun === flex).length;
      }
      expect(shots, `${c.id} observer rounds`).toBeGreaterThan(10);
    }
  });
});
