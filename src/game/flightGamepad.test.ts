import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { InputManager, readGamepad } from './input';

interface TestPad {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}
function pad(index = 0, id = 'Xbox', mapping = 'standard'): TestPad {
  return { index, id, mapping, connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
function button(p: TestPad, index: number, held: boolean, value = held ? 1 : 0): void {
  p.buttons[index] = { pressed: held, value };
}
function setup(pads: (TestPad | null)[]) {
  const controls = { ...DEFAULT_SETTINGS.controls, mouseMode: 'off' as const, gamepadEnabled: true };
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const input = new InputManager(new EventTarget() as HTMLElement, () => controls);
  return { input, controls, frame: () => input.update(1 / 60, null, false) };
}
function connection(target: EventTarget, type: string, p: TestPad): void {
  const event = new Event(type);
  Object.assign(event, { gamepad: p });
  target.dispatchEvent(event);
}
afterEach(() => vi.unstubAllGlobals());

describe('flight standard controller ownership and disarming', () => {
  it('detects press, hold, release and repress with shared output/history storage', () => {
    const p = pad();
    const cs = DEFAULT_SETTINGS.controls;
    const out = readGamepad(p, [], cs, 1 / 60, { bombsightMode: true });
    const pressed = out.pressed;
    const commands = out.commands;
    const sample = () => readGamepad(p, pressed, cs, 1 / 60, { bombsightMode: true }, out);
    for (const i of [0, 2, 7, 9]) button(p, i, false, 0.6);
    expect(sample()).toMatchObject({ clearJam: true, fire: true, releaseBomb: true, commands: ['releaseBomb', 'pause'] });
    expect(sample()).toMatchObject({ clearJam: false, fire: true, releaseBomb: true, commands: [] });
    for (const i of [0, 2, 7, 9]) button(p, i, false);
    expect(sample()).toMatchObject({ clearJam: false, fire: false, releaseBomb: false, commands: [] });
    for (const i of [0, 2, 7, 9]) button(p, i, true);
    expect(sample()).toMatchObject({ clearJam: true, fire: true, releaseBomb: true, commands: ['releaseBomb', 'pause'] });
    expect(out.pressed).toBe(pressed);
    expect(out.commands).toBe(commands);
  });

  it('ignores nonstandard devices and pins the first standard owner despite array reordering or activity', () => {
    const custom = pad(0, 'custom', '');
    const first = pad(2, 'first');
    const second = pad(3, 'second');
    const pads = [custom, first, second];
    const { input, frame } = setup(pads);
    frame();
    button(second, 7, true);
    pads.reverse();
    expect(frame().controls.fireGuns).toBe(false);
    expect(input.gamepadOwner).toEqual({ index: 2, id: 'first' });
    expect(input.getGamepad()).toBe(first);
    button(first, 7, false, 0.6);
    expect(frame().controls.fireGuns).toBe(true);
    first.connected = false;
    expect(frame().controls.fireGuns).toBe(false);
    expect(input.consumeGamepadLoss()).toBe(true);
    expect(input.consumeGamepadLoss()).toBe(false);
    expect(input.gamepadOwner).toEqual({ index: 3, id: 'second' });
  });

  it('blocks held connect controls and axes but permits a fresh Menu and map-close before neutral', () => {
    const p = pad();
    p.axes = [1, -1, 1, -1];
    button(p, 7, false, 0.7);
    button(p, 2, true);
    button(p, 9, true);
    const { input, frame } = setup([p]);
    input.bombsightMode = true;
    expect(frame()).toMatchObject({ controls: { roll: 0, pitch: 0, fireGuns: false, releaseBomb: false }, commands: [], lookDelta: { yaw: 0, pitch: 0 } });
    button(p, 9, false);
    frame();
    button(p, 9, true);
    button(p, 8, true);
    expect(frame().commands).toEqual(['map', 'pause']);
    expect(frame().commands).toEqual([]);
    p.axes.fill(0);
    for (let i = 0; i < p.buttons.length; i++) button(p, i, false);
    frame();
    button(p, 7, false, 0.7);
    button(p, 2, true);
    expect(frame()).toMatchObject({ controls: { fireGuns: true, releaseBomb: true }, commands: ['releaseBomb'] });
    expect(frame().commands).toEqual([]);
    button(p, 2, false);
    expect(frame().controls.releaseBomb).toBe(false);
    button(p, 2, true);
    expect(frame().commands).toEqual(['releaseBomb']);
  });

  it('rebases holds on actual context changes, not repeated setters, and requires real neutral', () => {
    const p = pad();
    const { input, frame } = setup([p]);
    frame();
    button(p, 2, true);
    expect(frame().commands).toEqual(['nextTarget']);
    input.bombsightMode = true;
    button(p, 7, true);
    p.axes[0] = 1;
    expect(frame()).toMatchObject({ controls: { fireGuns: false, releaseBomb: false, roll: 0 }, commands: [] });
    p.axes[0] = 0;
    button(p, 2, false);
    button(p, 7, false);
    frame();
    button(p, 2, true);
    input.bombsightMode = true;
    expect(frame()).toMatchObject({ controls: { releaseBomb: true }, commands: ['releaseBomb'] });
    input.stationMode = true;
    expect(frame().controls.releaseBomb).toBe(false);
    input.cancelTransientInput();
    expect(frame().commands).toEqual([]);
  });

  it('routes crew bumpers to seats, aims LS with inversion once, and preserves RT/A', () => {
    const p = pad();
    const { input, controls, frame } = setup([p]);
    input.stationMode = true;
    controls.invertPitch = true;
    frame();
    p.axes[0] = 1;
    p.axes[1] = 1;
    button(p, 4, true);
    button(p, 5, true);
    button(p, 7, true);
    button(p, 0, true);
    const result = frame();
    expect(result.commands).toEqual(['stationPrev', 'stationNext']);
    expect(result.controls).toMatchObject({ roll: 0, pitch: 0, yaw: 0, fireGuns: true, clearJam: true });
    expect(result.stationAim!.azimuth).toBeGreaterThan(0);
    expect(result.stationAim!.elevation).toBeLessThan(0);
    expect(frame().controls.clearJam).toBe(false);
  });

  it('disarms capture and settings disable-enable without disabling fresh safe navigation', () => {
    const p = pad();
    const { input, controls, frame } = setup([p]);
    input.bombsightMode = true;
    frame();
    button(p, 7, true);
    button(p, 2, true);
    p.axes[1] = 1;
    expect(frame().controls.fireGuns).toBe(true);
    input.enabled = false;
    expect(frame().controls).toMatchObject({ fireGuns: false, releaseBomb: false, pitch: 0 });
    input.enabled = true;
    expect(frame().controls).toMatchObject({ fireGuns: false, releaseBomb: false, pitch: 0 });
    controls.gamepadEnabled = false;
    button(p, 9, true);
    expect(frame().commands).toEqual([]);
    controls.gamepadEnabled = true;
    expect(frame().commands).toEqual([]);
    button(p, 9, false);
    frame();
    button(p, 9, true);
    expect(frame().commands).toEqual(['pause']);
    p.axes.fill(0);
    for (let i = 0; i < p.buttons.length; i++) button(p, i, false);
    frame();
    button(p, 7, true);
    expect(frame().controls.fireGuns).toBe(true);
  });

  it('consumes same-slot connection event snapshots, preserves subsequent Menu, and detaches listeners', () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const old = pad();
    const pads = [old];
    const { input, frame } = setup(pads);
    input.attach();
    input.attach();
    frame();
    button(old, 7, true);
    expect(frame().controls.fireGuns).toBe(true);
    old.connected = false;
    connection(win, 'gamepaddisconnected', old);
    const replacement = pad();
    button(replacement, 7, true);
    button(replacement, 2, true);
    pads[0] = replacement;
    connection(win, 'gamepadconnected', replacement);
    button(replacement, 9, true);
    expect(frame()).toMatchObject({ controls: { fireGuns: false }, commands: ['pause'] });
    expect(input.consumeGamepadLoss()).toBe(true);
    expect(input.consumeGamepadLoss()).toBe(false);
    for (let i = 0; i < replacement.buttons.length; i++) button(replacement, i, false);
    frame();
    button(replacement, 7, true);
    win.dispatchEvent(new Event('blur'));
    expect(frame().controls.fireGuns).toBe(false);
    button(replacement, 7, false);
    frame();
    button(replacement, 7, true);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(frame().controls.fireGuns).toBe(false);
    input.detach();
    connection(win, 'gamepadconnected', replacement);
    expect(input.gamepadOwner).toBeNull();
  });
});
