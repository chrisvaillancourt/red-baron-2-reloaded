import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { DefenseGamepad } from './defenseGamepad';

const pad = (index = 0, id = 'Xbox') => ({ index, id, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const controls = { ...DEFAULT_SETTINGS.controls, gamepadEnabled: true };

it('a held trigger cannot cross station, disconnect or replacement-controller ownership', () => {
  const input = new DefenseGamepad();
  const first = pad();
  const second = pad(1, 'second Xbox');
  input.update([first, second], controls, 1 / 60);
  first.buttons[7].value = 0.6;
  expect(input.update([first, second], controls, 1 / 60).fire).toBe(true);
  input.reset();
  expect(input.update([first, second], controls, 1 / 60).fire).toBe(false);
  first.buttons[7].value = 0;
  input.update([first, second], controls, 1 / 60);
  first.buttons[7].value = 0.6;
  expect(input.update([second, first], controls, 1 / 60).fire).toBe(true);
  second.buttons[7].pressed = true;
  first.connected = false;
  const changed = input.update([first, second], controls, 1 / 60);
  expect(changed.lost).toBe(true);
  expect(changed.fire).toBe(false);
  expect(input.update([second], controls, 1 / 60).fire).toBe(false);
  second.buttons[7].pressed = false;
  input.update([second], controls, 1 / 60);
  second.buttons[7].pressed = true;
  expect(input.update([second], controls, 1 / 60).fire).toBe(true);
});

it('battery commands are press edges; aim/focus/fuze remain continuous with inversion and deadzone', () => {
  const input = new DefenseGamepad();
  const controller = pad();
  input.update([controller], controls, 1 / 60);
  for (const i of [2, 5, 9, 11, 12]) controller.buttons[i].pressed = true;
  controller.buttons[6].value = 0.6;
  controller.axes[0] = 1;
  controller.axes[1] = -1;
  const first = input.update([controller], controls, 0.1);
  expect([first.station, first.reload, first.range, first.pause]).toEqual([1, true, true, true]);
  expect(first.focus).toBe(true);
  expect(first.yaw).toBeLessThan(0);
  expect(first.pitch).toBeGreaterThan(0);
  expect(first.fuze).toBeGreaterThan(0);
  const yaw = first.yaw;
  const held = input.update([controller], { ...controls, invertPitch: true }, 0.2);
  expect([held.station, held.reload, held.range, held.pause]).toEqual([0, false, false, false]);
  expect(held.pitch).toBeLessThan(0);
  expect(held.yaw).toBeCloseTo(yaw * 2);
  controller.axes[0] = controller.axes[1] = controls.gamepadDeadzone / 2;
  expect(input.update([controller], controls, 0.1).yaw).toBeCloseTo(0);
  expect(input.frame.pitch).toBeCloseTo(0);
  controller.axes[0] = controller.axes[1] = 0;
  controller.axes[2] = 1;
  controller.axes[3] = -1;
  controller.buttons[11].pressed = false;
  controller.buttons[3].pressed = true;
  const unused = input.update([controller], controls, 0.1);
  expect(unused.range).toBe(false); // Y no longer ranges; right-stick motion does not aim.
  expect(unused.yaw).toBeCloseTo(0);
  expect(unused.pitch).toBeCloseTo(0);
});

it('combat waits for the left aim stick to center after a pause or station handoff', () => {
  const input = new DefenseGamepad();
  const controller = pad();
  input.update([controller], controls, 1 / 60);
  input.reset();
  controller.axes[0] = 0.8;
  input.update([controller], controls, 1 / 60);
  controller.buttons[7].pressed = true;
  controller.buttons[11].pressed = true;
  const held = input.update([controller], controls, 1 / 60);
  expect(held.fire).toBe(false);
  expect(held.range).toBe(false);
  expect(held.yaw).toBeCloseTo(0);
  controller.buttons[7].pressed = controller.buttons[11].pressed = false;
  controller.axes[0] = 0;
  input.update([controller], controls, 1 / 60);
  controller.axes[0] = 0.8;
  controller.buttons[7].pressed = controller.buttons[11].pressed = true;
  const fresh = input.update([controller], controls, 1 / 60);
  expect(fresh.fire).toBe(true);
  expect(fresh.range).toBe(true);
  expect(fresh.yaw).toBeLessThan(0);
});

it('Menu can pause while fire is waiting for neutral, without toggling again while held', () => {
  const input = new DefenseGamepad();
  const controller = pad();
  input.update([controller], controls, 1 / 60);
  controller.buttons[7].pressed = true;
  input.update([controller], controls, 1 / 60);
  input.reset();
  controller.buttons[9].pressed = true;
  expect(input.update([controller], controls, 1 / 60).pause).toBe(true);
  expect(input.frame.fire).toBe(false);
  input.reset();
  expect(input.update([controller], controls, 1 / 60).pause).toBe(false);
  expect(input.frame.fire).toBe(false);
});

it('disabled or nonstandard controllers cannot own combat, and re-enabling requires released fire', () => {
  const input = new DefenseGamepad();
  const unsupported = pad();
  unsupported.mapping = '';
  unsupported.buttons[7].pressed = true;
  expect(input.update([unsupported], controls, 1 / 60).connected).toBe(false);
  const controller = pad(1, 'standard Xbox');
  input.update([unsupported, controller], controls, 1 / 60);
  controller.buttons[7].pressed = true;
  expect(input.update([unsupported, controller], controls, 1 / 60).fire).toBe(true);
  const disabled = input.update([controller], { ...controls, gamepadEnabled: false }, 1 / 60);
  expect(disabled.connected).toBe(false);
  expect(disabled.lost).toBe(true);
  expect(disabled.fire).toBe(false);
  expect(input.update([controller], controls, 1 / 60).fire).toBe(false);
  controller.buttons[7].pressed = false;
  input.update([controller], controls, 1 / 60);
  controller.buttons[7].pressed = true;
  expect(input.update([controller], controls, 1 / 60).fire).toBe(true);
});
