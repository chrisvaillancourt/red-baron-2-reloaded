import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../core/settings';
import { ACTIONS, codeLabel, duplicateBindings, findConflicts, rebind, unbind } from './bindings';

describe('action metadata', () => {
  it('covers every default binding', () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    for (const action of Object.keys(DEFAULT_KEY_BINDINGS)) expect(ids.has(action), action).toBe(true);
  });
  it('defaults have no duplicate keys', () => {
    expect([...duplicateBindings(DEFAULT_KEY_BINDINGS).keys()]).toEqual([]);
  });
});

describe('codeLabel', () => {
  it('humanises codes', () => {
    expect(codeLabel('KeyA')).toBe('A');
    expect(codeLabel('Digit9')).toBe('9');
    expect(codeLabel('Numpad4')).toBe('Num 4');
    expect(codeLabel('ArrowUp')).toBe('↑');
    expect(codeLabel('F4')).toBe('F4');
  });
});

describe('rebind', () => {
  const base = { fire: ['Space'], blip: ['KeyB'], clearJam: ['KeyU', 'KeyJ'] };

  it('finds conflicts excluding self', () => {
    expect(findConflicts(base, 'KeyB')).toEqual(['blip']);
    expect(findConflicts(base, 'KeyB', 'blip')).toEqual([]);
  });

  it('swap gives the displaced action our old key', () => {
    const next = rebind(base, 'fire', 0, 'KeyB', 'swap');
    expect(next.fire).toEqual(['KeyB']);
    expect(next.blip).toEqual(['Space']);
    expect(base.fire).toEqual(['Space']); // immutable
  });

  it('clear removes the key from the other action', () => {
    const next = rebind(base, 'fire', 0, 'KeyB', 'clear');
    expect(next.fire).toEqual(['KeyB']);
    expect(next.blip).toEqual([]);
  });

  it('appends to a new secondary slot', () => {
    const next = rebind(base, 'fire', 1, 'Enter');
    expect(next.fire).toEqual(['Space', 'Enter']);
  });

  it('moving a key between own slots does not duplicate it', () => {
    const next = rebind(base, 'clearJam', 0, 'KeyJ');
    expect(next.clearJam).toEqual(['KeyJ']);
  });

  it('swap does not create a duplicate on the displaced action', () => {
    const b = { a: ['KeyA'], b: ['KeyB', 'KeyA'] };
    // a's old key (KeyA) would be swapped into b, which already has it.
    const next = rebind({ a: ['KeyQ'], b: ['KeyB', 'KeyQ'] }, 'a', 0, 'KeyB', 'swap');
    expect(next.b).toEqual(['KeyQ']);
    expect(duplicateBindings(next).size).toBe(0);
    expect(b.a).toEqual(['KeyA']);
  });

  it('unbind removes a slot', () => {
    expect(unbind(base, 'clearJam', 0).clearJam).toEqual(['KeyJ']);
  });
});
