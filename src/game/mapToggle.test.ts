import { afterEach, expect, it, vi } from 'vitest';
import type { ControlInputs } from '../core/types';
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../core/settings';
import { headlessModules } from './autoplay';
import { CameraRig } from './cameras';
import { FlightSession } from './flightSession';
import { InputManager } from './input';
import { PlayerCrew } from './playerCrew';
import { SimCore } from './simCore';
import { bristolFight } from './testing/crewMissions';

/**
 * The desktop map does not capture flight input: the pilot flies on beneath it, so opening
 * or closing it leaves held keys, mouse and pad alone (touch-capable maps still cancel).
 * Drives FlightSession.tick up to the first simulation step of each frame, without a renderer.
 */
afterEach(() => vi.unstubAllGlobals());

function device() {
  return { index: 0, id: 'map pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}

function desktopSession(pads: ReturnType<typeof device>[]) {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null }));
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const mission = bristolFight();
  const core = new SimCore(headlessModules, mission, () => DEFAULT_SETTINGS.realism);
  const settings = { ...DEFAULT_SETTINGS, controls: { ...DEFAULT_SETTINGS.controls, mouseMode: 'off' as const, gamepadEnabled: true } };
  const input = new InputManager(new EventTarget() as HTMLElement, () => settings.controls);
  input.attach();
  const rig = new CameraRig(70, 16 / 9);
  const crew = new PlayerCrew({ core, input, rig, message: () => {}, bindings: () => DEFAULT_KEY_BINDINGS, visual: () => undefined });
  const session = new FlightSession({} as never, {} as never, mission, settings, {} as never) as unknown as { tick(now: number): void; mapOpen: boolean };
  const stepped: ControlInputs[] = [];
  const stop = new Error('first simulation step');
  Object.assign(session, {
    core, world: core.world, combat: core.combat, director: core.director, input, rig, crew,
    hud: { menuOpen: false, showMap: () => {} },
    step: () => {
      stepped.push({ ...core.world.player!.controls });
      throw stop;
    },
  });
  let now = 0;
  const frame = () => {
    now += 1000 / 60;
    expect(() => session.tick(now)).toThrow(stop);
    return stepped[stepped.length - 1];
  };
  const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  return { session, frame, key };
}

it('B closing the desktop map keeps a held RT and stick firing and rolling', () => {
  const pad = device();
  const { session, frame } = desktopSession([pad]);
  frame();
  session.mapOpen = true;
  pad.buttons[7] = { pressed: true, value: 1 };
  pad.axes[0] = 0.8;
  expect(frame()).toMatchObject({ fireGuns: true });
  pad.buttons[1] = { pressed: true, value: 1 };
  const closing = frame();
  expect(session.mapOpen).toBe(false);
  expect(closing.fireGuns).toBe(true);
  expect(closing.roll).toBeGreaterThan(0.5);
  pad.buttons[1] = { pressed: false, value: 0 };
  for (let i = 0; i < 3; i++) {
    const c = frame();
    expect(c.fireGuns).toBe(true);
    expect(c.roll).toBeGreaterThan(0.5);
  }
});

it('M opening and closing the desktop map keeps a held roll key', () => {
  const { session, frame, key } = desktopSession([]);
  key('keydown', 'ArrowRight');
  let c = frame();
  for (let i = 0; i < 30; i++) c = frame();
  expect(c.roll).toBeGreaterThan(0.5);
  for (const open of [true, false]) {
    key('keydown', 'KeyM');
    c = frame();
    key('keyup', 'KeyM');
    expect(session.mapOpen).toBe(open);
    expect(c.roll).toBeGreaterThan(0.5);
    expect(frame().roll).toBeGreaterThan(0.5);
  }
});
