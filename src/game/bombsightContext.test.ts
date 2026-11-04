import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from './input';
import { DEFAULT_SETTINGS } from '../core/settings';

afterEach(() => vi.unstubAllGlobals());

function key(type: string, code: string, repeat = false) {
  const e = new Event(type) as Event & { code: string; repeat: boolean; preventDefault(): void };
  Object.assign(e, { code, repeat });
  return e;
}

describe('a bombsight context change leaves keyboard and mouse input alone', () => {
  it('keeps a held keyboard roll key with no pad connected', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null }));
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    const controls = { ...DEFAULT_SETTINGS.controls, mouseMode: 'off' as const };
    const input = new InputManager(new EventTarget() as HTMLElement, () => controls);
    input.attach();
    win.dispatchEvent(key('keydown', 'ArrowRight'));
    let roll = 0;
    for (let i = 0; i < 30; i++) roll = input.update(1 / 60, null, false).controls.roll;
    expect(roll).toBeGreaterThan(0.5);
    // Pilot presses F6: next tick FlightSession sets bombsightMode from rig.mode.
    input.bombsightMode = true;
    // Key still physically held: the OS sends repeats.
    for (let i = 0; i < 30; i++) {
      win.dispatchEvent(key('keydown', 'ArrowRight', true));
      roll = input.update(1 / 60, null, false).controls.roll;
    }
    expect(roll).toBeGreaterThan(0.5);
  });

  it('keeps a held mouse fire button in direct-stick mode', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null }));
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    const controls = { ...DEFAULT_SETTINGS.controls, mouseMode: 'direct-stick' as const };
    const element = new EventTarget() as HTMLElement;
    const input = new InputManager(element, () => controls);
    input.attach();
    const down = new Event('mousedown');
    Object.assign(down, { buttons: 1 });
    element.dispatchEvent(down);
    expect(input.update(1 / 60, null, true).controls.fireGuns).toBe(true);
    input.bombsightMode = true;
    expect(input.update(1 / 60, null, true).controls.fireGuns).toBe(true);
    input.bombsightMode = false;
    expect(input.update(1 / 60, null, true).controls.fireGuns).toBe(true);
  });
});
