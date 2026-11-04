/**
 * Gamepad presence and button glyphs for the UI. The button *mapping* lives
 * in src/game/input.ts (readGamepad); the glyph labels here must match it.
 */
import { h } from './dom';

let chosen: { index: number; id: string } | null = null;

/** A connected standard gamepad, if any. */
export function connectedPad(): Gamepad | null {
  try {
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    if (chosen) {
      const pad = pads[chosen.index];
      if (pad?.connected && pad.mapping === 'standard' && pad.id === chosen.id) return pad;
      chosen = null;
    }
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping !== 'standard') continue;
      chosen = { index: pad.index, id: pad.id };
      return pad;
    }
    return null;
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
  const on = (e: Event) => {
    const pad = (e as GamepadEvent).gamepad;
    if (pad?.mapping === 'standard') onChange(padName(pad.id), true);
  };
  const off = (e: Event) => {
    const pad = (e as GamepadEvent).gamepad;
    if (pad?.mapping !== 'standard') return;
    if (chosen?.index === pad.index && chosen.id === pad.id) chosen = null;
    onChange(padName(pad.id), false);
  };
  window.addEventListener('gamepadconnected', on);
  window.addEventListener('gamepaddisconnected', off);
  return () => {
    window.removeEventListener('gamepadconnected', on);
    window.removeEventListener('gamepaddisconnected', off);
  };
}
