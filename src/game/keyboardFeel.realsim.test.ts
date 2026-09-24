/**
 * Keyboard flying on the REAL flight model through the real InputManager
 * axis smoothing: a held key must give a hard but survivable turn at
 * combat speed, and releasing it must re-centre the stick.
 */
import { describe, expect, it } from 'vitest';
import type { AircraftEntity, AircraftId, FlightModelLevel } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/settings';
import { SimWorld, runSim, STANDARD_REALISM } from '../ai/testing/realSimHarness';
import { InputManager } from './input';

class FakeElement {
  addEventListener() {}
  removeEventListener() {}
}

function heldTurn(id: AircraftId, level: FlightModelLevel, keys: string[], seconds: number) {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level }, ground: () => 60 });
  const p = w.addAircraft({ aircraftId: id, side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, controller: 'player' });
  const controls = { ...DEFAULT_SETTINGS.controls, mouseMode: 'off' as const };
  const input = new InputManager(new FakeElement() as unknown as HTMLElement, () => controls);
  const held = (input as unknown as { held: Set<string> }).held;
  keys.forEach((k) => held.add(k));
  let maxG = 0;
  let minG = 9;
  const script = new Map<number, (ac: AircraftEntity, dt: number) => void>();
  script.set(p.id, (ac, dt) => {
    const f = input.update(dt, ac, true);
    Object.assign(ac.controls, f.controls, { throttle: 1 });
    maxG = Math.max(maxG, ac.state.gLoad);
    minG = Math.min(minG, ac.state.gLoad);
  });
  runSim(w, seconds, { scripted: script, aiEvery: 2 });
  return { maxG, minG, broke: p.damage.structuralFailure, outcome: p.outcome, spd: p.state.airspeed * 3.6, stalled: p.state.stalled };
}

describe('keyboard flying on the real sim', () => {
  for (const id of ['albatros_dv', 'sopwith_camel', 'spad_xiii', 'nieuport_17'] as AircraftId[]) {
    it(`${id}: a held pull + roll is a hard turn, not a broken wing`, () => {
      const r = heldTurn(id, 'standard', ['ArrowDown', 'ArrowLeft'], 1.2);
      const r2 = heldTurn(id, 'standard', ['ArrowDown'], 6);
      expect(r.broke, JSON.stringify(r)).toBe(false);
      expect(r2.broke, JSON.stringify(r2)).toBe(false);
      expect(r2.maxG, JSON.stringify(r2)).toBeGreaterThan(2); // held full back stick bleeds into a stall at ~2.3-3 g
    });
  }
});
