/**
 * Gamepad presence and button glyphs for the UI. The button *mapping* lives
 * in src/game/input.ts (readGamepad); the glyph labels here must match it.
 */
import { h } from './dom';

/** A connected standard gamepad, if any. */
export function connectedPad(): Gamepad | null {
  try {
    return [...(globalThis.navigator?.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected) ?? null;
  } catch {
    return null;
  }
}

/** Short readable name: "Xbox Wireless Controller" from the raw vendor string. */
export function padName(id: string): string {
  const clean = id
    .replace(/\(.*?\)/g, '')
    .replace(/Vendor:\s*\w+|Product:\s*\w+/gi, '')
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'Controller';
}

/** Xbox-layout face-button colours; everything else is a neutral pill. */
const FACE: Record<string, string> = { A: 'a', B: 'b', X: 'x', Y: 'y' };

/** A gamepad button glyph: "A", "RT", "LS", "D-pad ↑↓", "Start"… */
export function padGlyph(label: string): HTMLElement {
  const face = FACE[label];
  return h('span', { class: `pad-glyph ${face ? `face ${face}` : ''}`, title: `Gamepad ${label}` }, label);
}

/**
 * Subscribe to controller connect/disconnect; returns an unsubscribe.
 * `onChange(name, connected)` is called with a readable controller name.
 */
export function onPadChange(onChange: (name: string, connected: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const on = (e: Event) => onChange(padName((e as GamepadEvent).gamepad?.id ?? ''), true);
  const off = (e: Event) => onChange(padName((e as GamepadEvent).gamepad?.id ?? ''), false);
  window.addEventListener('gamepadconnected', on);
  window.addEventListener('gamepaddisconnected', off);
  return () => {
    window.removeEventListener('gamepadconnected', on);
    window.removeEventListener('gamepaddisconnected', off);
  };
}
