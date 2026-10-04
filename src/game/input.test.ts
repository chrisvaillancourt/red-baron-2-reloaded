import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../core/settings';
import type { AircraftEntity, ControlSettings } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { terrainHeightAt } from '../world/terrain';
import {
  actionsForCode,
  applyDeadzone,
  approach,
  createMouseAimState,
  EDGE_ACTIONS,
  expo,
  InputManager,
  STATION_KEY_AIM_RATE_DEG,
  stationAimDelta,
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

describe('gunner aim input', () => {
  const cs = DEFAULT_SETTINGS.controls;

  it('swings the gun right and up with the mouse moved right and up', () => {
    const d = stationAimDelta({ mouseDX: 100, mouseDY: -50, keyAz: 0, keyEl: 0, padAz: 0, padEl: 0 }, cs, 1 / 60);
    expect(d.azimuth).toBeGreaterThan(0);
    expect(d.elevation).toBeGreaterThan(0);
    // The same scale as the mouse-aim instructor: 0.0022 rad per pixel at sensitivity 1.
    expect(d.azimuth).toBeCloseTo(0.22, 6);
  });

  it('honours invert pitch and sensitivity', () => {
    const d = stationAimDelta({ mouseDX: 0, mouseDY: -50, keyAz: 0, keyEl: 0, padAz: 0, padEl: 0 }, { ...cs, invertPitch: true, mouseSensitivity: 2 }, 1 / 60);
    expect(d.elevation).toBeCloseTo(-0.22, 6);
  });

  it('swings with the keys and the stick at a steady rate', () => {
    const d = stationAimDelta({ mouseDX: 0, mouseDY: 0, keyAz: 1, keyEl: 0, padAz: 0, padEl: -1 }, cs, 0.5);
    expect(d.azimuth).toBeCloseTo((STATION_KEY_AIM_RATE_DEG * 0.5 * Math.PI) / 180, 6);
    expect(d.elevation).toBeCloseTo((-STATION_KEY_AIM_RATE_DEG * 0.5 * Math.PI) / 180, 6);
  });

  it('release bomb is held: true while the key is down', () => {
    const im = new InputManager({} as HTMLElement, () => ({ ...cs, gamepadEnabled: false }));
    const held = (im as unknown as { held: Set<string> }).held;
    held.add('KeyR');
    expect(im.update(1 / 60, null, true).controls.releaseBomb).toBe(true);
    expect(im.update(1 / 60, null, true).controls.releaseBomb).toBe(true);
    held.delete('KeyR');
    expect(im.update(1 / 60, null, true).controls.releaseBomb).toBe(false);
  });

  it('crew-station keys are edge actions', () => {
    for (const a of ['stationNext', 'stationPrev', 'stationPilot', 'releaseBomb', 'viewBombsight']) expect(EDGE_ACTIONS as readonly string[]).toContain(a);
  });
});

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

describe('touch input frames', () => {
  function touchInput(overrides: Partial<ControlSettings> = {}) {
    const cs = { ...DEFAULT_SETTINGS.controls, gamepadEnabled: false, ...overrides };
    const input = new InputManager({} as HTMLElement, () => cs);
    input.touchActive = true;
    return input;
  }

  it('owns the centred pilot stick instead of letting the mouse instructor level a bank', () => {
    const ac = aircraft();
    ac.state.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 6));
    const desktop = new InputManager({} as HTMLElement, () => ({ ...DEFAULT_SETTINGS.controls, gamepadEnabled: false }));
    expect(desktop.update(1 / 60, ac, true).controls.roll).toBeLessThan(-0.2);

    const input = touchInput();
    const frame = input.update(1 / 60, ac, true);
    expect(frame.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0, fireGuns: false, blip: false, releaseBomb: false });
    expect(frame.aimDirection).toBeNull();
    expect(frame.manualOverride).toBe(true);
    expect(frame.commands).toEqual([]);
    input.touchActive = false;
    expect(input.update(1 / 60, ac, true).controls.roll).toBeLessThan(-0.2);
  });

  it('maps right/down to roll right/nose-up and inverts pilot pitch exactly once', () => {
    for (const invertPitch of [false, true]) {
      const input = touchInput({ invertPitch });
      input.setTouchState({ stickX: 1, stickY: 1, rudder: -1 });
      const frame = input.update(0.25, aircraft(), true);
      expect(frame.controls).toMatchObject({ roll: 1, pitch: invertPitch ? -1 : 1, yaw: -1 });
      input.setTouchState({ stickX: -1, stickY: -1, rudder: 1 });
      expect(input.update(1 / 60, aircraft(), false).controls).toMatchObject({ roll: -1, pitch: invertPitch ? 1 : -1, yaw: 1 });
    }
  });

  it('reuses the configured stick deadzone and soft response, reaching neutral without drift', () => {
    const input = touchInput({ gamepadDeadzone: 0.2 });
    input.setTouchState({ stickX: 0.1, stickY: -0.2, rudder: 0.1, lookX: 0.2, lookY: -0.1 });
    const rest = input.update(0.5, null, true);
    expect(rest.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0 });
    expect(rest.lookDelta).toEqual({ yaw: 0, pitch: 0 });
    input.setTouchState({ stickX: 0.6, stickY: -0.6, rudder: 0.6 });
    const middle = input.update(0.5, null, true);
    expect(middle.controls.roll).toBeCloseTo(0.35);
    expect(middle.controls.pitch).toBeCloseTo(-0.35);
    expect(middle.controls.yaw).toBeCloseTo(0.5);
    input.setTouchState({ stickX: 0, stickY: 0, rudder: 0 });
    expect(input.update(1 / 60, null, true).controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0 });
  });

  it('swings a crew gun right/up at 60 degrees per second with inversion and dt applied once', () => {
    for (const invertPitch of [false, true]) {
      const input = touchInput({ invertPitch });
      input.stationMode = true;
      input.setTouchState({ stickX: 1, stickY: -1, rudder: 1, fire: true });
      const frame = input.update(0.5, aircraft(), true);
      expect(frame.stationAim!.azimuth).toBeCloseTo(Math.PI / 6);
      expect(frame.stationAim!.elevation).toBeCloseTo(invertPitch ? -Math.PI / 6 : Math.PI / 6);
      expect(frame.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0, fireGuns: true });
      expect(frame.manualOverride).toBe(false);
      const shorter = input.update(0.25, aircraft(), true);
      expect(shorter.stationAim!.azimuth).toBeCloseTo(Math.PI / 12);
      expect(shorter.stationAim!.elevation).toBeCloseTo(invertPitch ? -Math.PI / 12 : Math.PI / 12);
    }
  });

  it('maps screen look right/down to camera yaw-/pitch- rates, independently of pitch inversion', () => {
    for (const invertPitch of [false, true]) {
      const input = touchInput({ invertPitch });
      input.setTouchState({ lookX: 1, lookY: 1 });
      expect(input.update(0.2, null, true).lookDelta).toEqual({ yaw: -0.5, pitch: -0.4 });
      input.setTouchState({ lookX: -1, lookY: -1 });
      expect(input.update(0.1, null, false).lookDelta).toEqual({ yaw: 0.25, pitch: 0.2 });
    }
  });

  it('holds fire/blip without synthesizing edge commands and merges partial state updates', () => {
    const input = touchInput();
    input.setTouchState({ fire: true, blip: true });
    input.setTouchState({ stickX: 1 });
    for (let i = 0; i < 2; i++) {
      const frame = input.update(1 / 60, null, true);
      expect(frame.controls).toMatchObject({ fireGuns: true, blip: true, roll: 1, releaseBomb: false });
      expect(frame.commands).toEqual([]);
    }
    input.setTouchState({ fire: false, blip: false });
    expect(input.update(1 / 60, null, true).controls).toMatchObject({ fireGuns: false, blip: false, roll: 1 });
  });

  it('uses the authoritative throttle setter and preserves it through interruption', () => {
    const input = touchInput();
    input.setThrottle(0.37);
    input.setTouchState({ fire: true, lookX: 1, stickY: 1 });
    input.cancelTransientInput();
    const frame = input.update(0.5, null, true);
    expect(input.throttleValue).toBe(0.37);
    expect(frame.controls).toMatchObject({ throttle: 0.37, pitch: 0, roll: 0, yaw: 0, fireGuns: false, blip: false });
    expect(frame.lookDelta).toEqual({ yaw: 0, pitch: 0 });
    input.setThrottle(2);
    expect(input.throttleValue).toBe(1);
    input.setThrottle(-1);
    expect(input.update(1 / 60, null, true).controls.throttle).toBe(0);
  });

  it('cancels old touch state on seat, enabled and touch-ownership transitions and detach', () => {
    const input = touchInput();
    input.setThrottle(0.4);
    for (const transition of [
      () => { input.stationMode = !input.stationMode; },
      () => { input.enabled = false; input.setTouchState({ fire: true }); input.enabled = true; },
      () => { input.touchActive = false; input.setTouchState({ fire: true }); input.touchActive = true; },
      () => input.detach(),
    ]) {
      input.setTouchState({ stickX: 1, stickY: -1, rudder: 1, lookX: 1, lookY: 1, fire: true, blip: true });
      transition();
      const frame = input.update(0.5, null, true);
      expect(frame.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0, throttle: 0.4, fireGuns: false, blip: false });
      expect(frame.stationAim ?? { azimuth: 0, elevation: 0 }).toEqual({ azimuth: 0, elevation: 0 });
      expect(frame.lookDelta).toEqual({ yaw: 0, pitch: 0 });
      expect(frame.commands).toEqual([]);
    }
  });

  it('hands back the AI throttle and direct stick after clearing old touch intent', () => {
    const input = touchInput({ mouseMode: 'direct-stick' });
    const ac = aircraft();
    ac.controls.throttle = 0.61;
    ac.controls.roll = -0.3;
    ac.controls.pitch = 0.2;
    input.setTouchState({ stickX: 1, fire: true });
    input.touchActive = false;
    input.syncTo(ac);
    expect(input.throttleValue).toBe(0.61);
    expect(input.update(1 / 60, ac, true).controls).toMatchObject({ throttle: 0.61, roll: -0.3, pitch: 0.2, fireGuns: false });
    input.touchActive = true;
    expect(input.update(1 / 60, ac, true).controls).toMatchObject({ throttle: 0.61, roll: 0, pitch: 0 });
  });

  it('syncs a fresh desktop mouse aim to the AI nose and clears held/queued desktop input', () => {
    const input = touchInput();
    const ac = aircraft(Math.PI / 2);
    ac.controls.throttle = 0.58;
    input.touchActive = false;
    // Desktop fixture matches the existing held-key tests; no DOM event wiring is mocked.
    const desktop = input as unknown as { held: Set<string>; pressedQueue: string[] };
    desktop.held.add('Space');
    desktop.pressedQueue.push('KeyR');
    input.syncTo(ac);
    const frame = input.update(1 / 60, ac, true);
    expect(frame.aimDirection!.angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(frame.controls).toMatchObject({ throttle: 0.58, fireGuns: false, releaseBomb: false });
    expect(frame.commands).toEqual([]);
  });

  it('clears desktop deltas, held/queued controls and smoothing without losing throttle', () => {
    const cs = { ...DEFAULT_SETTINGS.controls, mouseMode: 'direct-stick' as const, gamepadEnabled: false };
    const input = new InputManager({} as HTMLElement, () => cs);
    const desktop = input as unknown as {
      held: Set<string>; pressedQueue: string[]; mouseDX: number; mouseDY: number; mouseButtons: number; wheel: number;
    };
    desktop.held.add('ArrowDown');
    desktop.held.add('Space');
    desktop.mouseDX = 100;
    desktop.mouseDY = 100;
    expect(input.update(0.1, null, true).controls.pitch).toBeGreaterThan(0);
    input.setThrottle(0.42);
    desktop.pressedQueue.push('KeyR');
    desktop.mouseDX = desktop.mouseDY = desktop.wheel = 100;
    desktop.mouseButtons = 3;
    input.cancelTransientInput();
    const frame = input.update(0.01, null, true);
    expect(frame.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0, throttle: 0.42, fireGuns: false, releaseBomb: false });
    expect(frame.commands).toEqual([]);
    expect(frame.lookDelta).toEqual({ yaw: 0, pitch: 0 });
  });

  it('drops the old direct stick when the mouse control mode changes', () => {
    const cs: ControlSettings = { ...DEFAULT_SETTINGS.controls, mouseMode: 'direct-stick', gamepadEnabled: false };
    const input = new InputManager({} as HTMLElement, () => cs);
    const ac = aircraft();
    ac.controls.roll = 0.7;
    ac.controls.pitch = -0.4;
    ac.controls.throttle = 0.46;
    input.syncTo(ac);
    expect(input.update(1 / 60, ac, true).controls).toMatchObject({ roll: 0.7, pitch: -0.4 });
    cs.mouseMode = 'off';
    expect(input.update(1 / 60, ac, true).controls).toMatchObject({ roll: 0, pitch: 0, throttle: 0.46 });
    cs.mouseMode = 'direct-stick';
    expect(input.update(1 / 60, ac, true).controls).toMatchObject({ roll: 0, pitch: 0, throttle: 0.46 });
  });

  it('disabled input emits no flight state or stale commands, while gamepad Start can still unpause', () => {
    const pad = { connected: true, axes: [1, 1, 1, 1], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    try {
      const input = touchInput({ gamepadEnabled: true });
      input.setThrottle(0.33);
      input.setTouchState({ fire: true, stickX: 1 });
      const desktop = input as unknown as { pressedQueue: string[] };
      desktop.pressedQueue.push('KeyR');
      input.enabled = false;
      pad.buttons[7] = { pressed: true, value: 1 };
      pad.buttons[12] = { pressed: true, value: 1 };
      pad.buttons[2] = { pressed: true, value: 1 };
      let frame = input.update(0.5, aircraft(), true);
      expect(frame.controls).toMatchObject({ pitch: 0, roll: 0, yaw: 0, throttle: 0.33, fireGuns: false, blip: false, releaseBomb: false, clearJam: false });
      expect(frame.commands).toEqual([]);
      expect(frame.lookDelta).toEqual({ yaw: 0, pitch: 0 });
      pad.buttons[9] = { pressed: true, value: 1 };
      frame = input.update(0.5, aircraft(), true);
      expect(frame.commands).toEqual(['pause']);
      expect(input.update(0.5, aircraft(), true).commands).toEqual([]);
      input.enabled = true;
      expect(input.update(0.5, aircraft(), true).commands).toEqual([]);
      pad.buttons[9] = { pressed: false, value: 0 };
      input.update(1 / 60, aircraft(), true);
      pad.buttons[9] = { pressed: true, value: 1 };
      expect(input.update(1 / 60, aircraft(), true).commands).toEqual(['pause']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
