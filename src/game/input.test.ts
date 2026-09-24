import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../core/settings';
import type { AircraftEntity } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { terrainHeightAt } from '../world/terrain';
import {
  actionsForCode,
  applyDeadzone,
  approach,
  createMouseAimState,
  expo,
  mouseAimControls,
  resolveHeldActions,
  snapLookFrom,
} from './input';
import { stubCreateFlightEnvironment, stubSim } from './stubs/sim';
import { createDamageState, emptyControls } from './world';

function aircraft(heading = 0): AircraftEntity {
  const spec = getAircraft('sopwith_camel');
  const env = stubCreateFlightEnvironment(terrainHeightAt, { cloudCover: 0, cloudBaseM: 0, cloudTopM: 0, wind: [0, 0, 0], visibilityM: 1e4, turbulence: 0 });
  return {
    id: 1,
    kind: 'aircraft',
    spec,
    side: 'allied',
    nation: 'britain',
    livery: { fuselage: '#000', wingTop: '#000', wingBottom: '#000', tail: '#000', cowling: '#000', accent: '#000', insignia: 'roundel-rfc' },
    callsign: 'test',
    skill: 'regular',
    flightId: 'f',
    controller: 'player',
    controls: emptyControls(1),
    state: stubSim.createFlightState(spec, { x: 0, z: 0, altitude: 2000, heading, airspeed: 45 }, env, false),
    guns: [],
    damage: createDamageState(),
    outcome: null,
  };
}

describe('key binding resolution', () => {
  it('maps held codes to actions using default bindings', () => {
    const a = resolveHeldActions(new Set(['ArrowDown', 'Space', 'KeyZ']), DEFAULT_KEY_BINDINGS);
    expect(a.has('pitchUp')).toBe(true);
    expect(a.has('fire')).toBe(true);
    expect(a.has('yawLeft')).toBe(true);
    expect(a.has('pitchDown')).toBe(false);
  });

  it('honours rebinding', () => {
    const b = { ...DEFAULT_KEY_BINDINGS, fire: ['KeyF'] };
    expect(resolveHeldActions(new Set(['Space']), b).has('fire')).toBe(false);
    expect(actionsForCode('KeyF', b)).toContain('fire');
  });

  it('every default action name is a known action', () => {
    expect(Object.keys(DEFAULT_SETTINGS.controls.keyBindings)).toEqual(Object.keys(DEFAULT_KEY_BINDINGS));
  });
});

describe('axis shaping', () => {
  it('applies deadzone and rescales to full range', () => {
    expect(applyDeadzone(0.1, 0.12)).toBe(0);
    expect(applyDeadzone(1, 0.12)).toBeCloseTo(1);
    expect(applyDeadzone(-0.56, 0.12)).toBeCloseTo(-0.5);
  });
  it('expo keeps endpoints and softens the centre', () => {
    expect(expo(1)).toBeCloseTo(1);
    expect(expo(-1)).toBeCloseTo(-1);
    expect(Math.abs(expo(0.3))).toBeLessThan(0.3);
  });
  it('approach moves at a bounded rate', () => {
    expect(approach(0, 1, 2, 0.1)).toBeCloseTo(0.2);
    expect(approach(0.95, 1, 2, 0.1)).toBe(1);
  });
});

describe('snap views', () => {
  it('combines look keys', () => {
    expect(snapLookFrom(new Set())).toBeNull();
    expect(snapLookFrom(new Set(['lookLeft']))!.yaw).toBeCloseTo(Math.PI / 2);
    expect(snapLookFrom(new Set(['lookBack']))!.yaw).toBeCloseTo(Math.PI);
    expect(snapLookFrom(new Set(['lookUp']))!.pitch).toBeGreaterThan(0.9);
  });
});

describe('mouse-aim instructor', () => {
  const run = (ac: AircraftEntity, aim: Vector3) => {
    const out = { pitch: 0, roll: 0, yaw: 0 };
    mouseAimControls(ac, aim, createMouseAimState(), 1 / 60, out);
    return out;
  };

  it('pulls up for an aim point above the nose', () => {
    const ac = aircraft();
    const out = run(ac, new Vector3(0, 0.3, -1).normalize());
    expect(out.pitch).toBeGreaterThan(0.5);
    expect(Math.abs(out.roll)).toBeLessThan(0.2);
  });

  it('banks right toward an aim point to the right', () => {
    const ac = aircraft(); // facing north (-Z); right is +X
    const out = run(ac, new Vector3(1, 0, -1).normalize());
    expect(out.roll).toBeGreaterThan(0.5);
    expect(out.yaw).toBeGreaterThan(0);
  });

  it('levels the wings when the aim is dead ahead', () => {
    const ac = aircraft();
    // Bank 30 degrees right: rotate about the body forward axis.
    ac.state.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 6));
    const fwd = new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation);
    const out = run(ac, fwd);
    expect(out.roll).toBeLessThan(-0.2); // roll left to level
  });

  it('flies the stub aircraft onto a new heading', () => {
    const ac = aircraft();
    const env = stubCreateFlightEnvironment(terrainHeightAt, { cloudCover: 0, cloudBaseM: 0, cloudTopM: 0, wind: [0, 0, 0], visibilityM: 1e4, turbulence: 0 });
    const aim = new Vector3(1, 0, 0); // east
    const st = createMouseAimState();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    for (let i = 0; i < 120 * 20; i++) {
      mouseAimControls(ac, aim, st, 1 / 120, out);
      Object.assign(ac.controls, out);
      stubSim.stepFlight(ac, env, DEFAULT_SETTINGS.realism, 1 / 120);
    }
    const fwd = new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation);
    expect(fwd.angleTo(aim)).toBeLessThan(0.2);
    expect(ac.outcome).toBeNull();
  });
});
