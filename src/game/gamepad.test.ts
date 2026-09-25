import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { readGamepad, type PadLike } from './input';

/** A virtual standard-mapping pad: 4 axes, 17 buttons, all at rest. */
function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = [], values: Record<number, number> = {}): PadLike {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
  };
}
const cs = DEFAULT_SETTINGS.controls;
const rest = Array<boolean>(17).fill(false);

describe('gamepad mapping (virtual pad)', () => {
  it('is neutral at rest and ignores stick noise inside the deadzone', () => {
    const f = readGamepad(pad([0.05, -0.08, 0.03, 0.02]), rest, cs, 1 / 60);
    expect([f.roll, f.pitch, f.yaw, f.lookYaw, f.lookPitch, f.throttleDelta]).toEqual([0, 0, 0, -0, -0, 0]);
    expect(f.fire || f.blip || f.clearJam).toBe(false);
    expect(f.commands).toEqual([]);
  });

  it('left stick flies: back is nose up, right is roll right; invert flips pitch', () => {
    const f = readGamepad(pad([1, 1, 0, 0]), rest, cs, 1 / 60);
    expect(f.roll).toBeCloseTo(1);
    expect(f.pitch).toBeCloseTo(1);
    expect(readGamepad(pad([0, 1, 0, 0]), rest, { ...cs, invertPitch: true }, 1 / 60).pitch).toBeCloseTo(-1);
  });

  it('bumpers are rudder, triggers fire and blip (pressed or half-pulled)', () => {
    expect(readGamepad(pad(undefined, [4]), rest, cs, 1 / 60).yaw).toBe(-1);
    expect(readGamepad(pad(undefined, [5]), rest, cs, 1 / 60).yaw).toBe(1);
    const f = readGamepad(pad(undefined, [], { 7: 0.6, 6: 0.5 }), rest, cs, 1 / 60);
    expect(f.fire).toBe(true);
    expect(f.blip).toBe(true);
  });

  it('D-pad up/down moves the throttle at the keyboard rate', () => {
    expect(readGamepad(pad(undefined, [12]), rest, cs, 0.5).throttleDelta).toBeCloseTo(0.25);
    expect(readGamepad(pad(undefined, [13]), rest, cs, 0.5).throttleDelta).toBeCloseTo(-0.25);
  });

  it('face buttons fire commands once per press (edge-triggered)', () => {
    const first = readGamepad(pad(undefined, [0, 3, 9]), rest, cs, 1 / 60);
    expect(first.clearJam).toBe(true);
    expect(first.commands).toEqual(['viewPadlock', 'pause']);
    const held = readGamepad(pad(undefined, [0, 3, 9]), first.pressed, cs, 1 / 60);
    expect(held.clearJam).toBe(false);
    expect(held.commands).toEqual([]);
  });

  it('maps the remaining buttons to views, targets, map and time compression', () => {
    const f = readGamepad(pad(undefined, [1, 2, 8, 10, 11, 14]), rest, cs, 1 / 60);
    expect(f.commands.sort()).toEqual(['map', 'nextTarget', 'padlockNearest', 'timeNormal', 'viewChase', 'viewCockpit']);
    expect(readGamepad(pad(undefined, [15]), rest, cs, 1 / 60).commands).toEqual(['timeCompress']);
  });

  it('right stick looks around', () => {
    const f = readGamepad(pad([0, 0, 1, -1]), rest, cs, 1);
    expect(f.lookYaw).toBeLessThan(0);
    expect(f.lookPitch).toBeGreaterThan(0);
  });
});
