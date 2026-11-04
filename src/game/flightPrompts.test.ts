import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { controllerFlightHint, PAD_PROMPTS, padPromptEffect, padPromptText, type PadEffect } from './flightPrompts';
import { InputManager, readGamepad, type PadFrame, type PadLike } from './input';

afterEach(() => vi.unstubAllGlobals());

const cs = { ...DEFAULT_SETTINGS.controls, invertPitch: false };
const CONTEXTS = [[false, false], [true, false], [false, true], [true, true]] as const;

function pad(buttons: number[] = [], axes: number[] = [0, 0, 0, 0]): PadLike {
  return { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) };
}
const read = (p: PadLike, atGun: boolean, bombsight: boolean): PadFrame =>
  readGamepad(p, [], cs, 1 / 60, { stationMode: atGun, bombsightMode: bombsight });

function expectEffect(effect: PadEffect, buttons: number[], atGun: boolean, bombsight: boolean): void {
  if ('commands' in effect) {
    expect(effect.commands).toHaveLength(buttons.length);
    buttons.forEach((b, i) => expect(read(pad([b]), atGun, bombsight).commands).toEqual([effect.commands[i]]));
  } else if ('held' in effect) {
    expect(read(pad(buttons), atGun, bombsight)[effect.held]).toBe(true);
  } else if ('signed' in effect) {
    expect(Math.sign(read(pad([buttons[0]]), atGun, bombsight)[effect.signed])).toBe(effect.first);
    expect(Math.sign(read(pad([buttons[1]]), atGun, bombsight)[effect.signed])).toBe(-effect.first);
  } else if (effect.stick === 'aim') {
    // At a gun the stick swings the gun through InputManager, not the flight controls.
    const p = { ...pad(), index: 0, id: 'pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0] };
    vi.stubGlobal('navigator', { getGamepads: () => [p] });
    const input = new InputManager({} as HTMLElement, () => ({ ...cs, mouseMode: 'off' as const, gamepadEnabled: true }));
    input.stationMode = atGun;
    input.bombsightMode = bombsight;
    input.update(1 / 60, null, false);
    p.axes = [0.9, 0.9, 0, 0];
    const f = input.update(1 / 60, null, false);
    expect(Math.abs(f.stationAim!.azimuth)).toBeGreaterThan(0);
    expect(Math.abs(f.stationAim!.elevation)).toBeGreaterThan(0);
    expect(f.controls).toMatchObject({ roll: 0, pitch: 0 });
  } else {
    const [x, y] = effect.stick === 'flight' ? [0, 1] : [2, 3];
    const axes = [0, 0, 0, 0];
    axes[x] = 0.9;
    axes[y] = 0.9;
    const f = read(pad([], axes), atGun, bombsight);
    const out = effect.stick === 'flight' ? [f.roll, f.pitch] : [f.lookYaw, f.lookPitch];
    out.forEach((v) => expect(Math.abs(v)).toBeGreaterThan(0));
  }
}

/**
 * Every button that changes readGamepad's output in a context, from the mapping itself.
 * At a gun the AI pilot owns blip, throttle and rudder, so those outputs do nothing there.
 */
function mappedButtons(atGun: boolean, bombsight: boolean): number[] {
  const live = (f: PadFrame) => JSON.stringify({ ...f, pressed: [], ...(atGun ? { blip: false, throttleDelta: 0, yaw: 0 } : {}) });
  const idle = live(read(pad(), atGun, bombsight));
  const out: number[] = [];
  for (let b = 0; b < 17; b++) {
    if (live(read(pad([b]), atGun, bombsight)) !== idle) out.push(b);
  }
  return out;
}

describe('controller prompts follow the readGamepad mapping', () => {
  for (const [atGun, bombsight] of CONTEXTS) {
    const label = `${atGun ? 'gunner' : 'pilot'}${bombsight ? ' in bombsight view' : ''}`;

    it(`every ${label} prompt does what its text says`, () => {
      for (const p of PAD_PROMPTS) {
        if (padPromptText(p, atGun, bombsight) === null) continue;
        expectEffect(padPromptEffect(p, atGun, bombsight), p.buttons, atGun, bombsight);
      }
    });

    it(`every button that acts for the ${label} is in that context's hint`, () => {
      const prompted = new Set(PAD_PROMPTS.filter((p) => padPromptText(p, atGun, bombsight) !== null).flatMap((p) => p.buttons));
      expect(mappedButtons(atGun, bombsight).filter((b) => !prompted.has(b))).toEqual([]);
    });
  }

  it('builds each context hint from the rows, naming the Flight actions path', () => {
    for (const [atGun, bombsight] of CONTEXTS) {
      const hint = controllerFlightHint(atGun, bombsight);
      for (const p of PAD_PROMPTS) {
        const text = padPromptText(p, atGun, bombsight);
        if (text) expect(hint).toContain(`${p.name} ${text}`);
      }
      expect(hint).toContain('press Menu and choose Flight actions');
      expect(hint).not.toContain('Menu → Flight actions');
    }
    expect(controllerFlightHint(false, false)).toContain('L3 selects cockpit view');
    expect(controllerFlightHint(true, false)).toContain('B returns to the pilot');
    expect(controllerFlightHint(true, false)).not.toContain('LT');
    expect(controllerFlightHint(false, true)).toContain('X held releases a bomb');
  });
});
