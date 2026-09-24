/**
 * Key-binding metadata and rebinding logic (pure; tested in Node).
 * Bindings map action -> KeyboardEvent.code[] (see src/core/settings.ts).
 */

export type ActionGroup = 'Flight' | 'Engine' | 'Weapons' | 'Views' | 'Wingmen' | 'Game';

export interface ActionMeta {
  id: string;
  label: string;
  group: ActionGroup;
}

export const ACTIONS: ActionMeta[] = [
  { id: 'pitchUp', label: 'Stick back (nose up)', group: 'Flight' },
  { id: 'pitchDown', label: 'Stick forward (nose down)', group: 'Flight' },
  { id: 'rollLeft', label: 'Roll left', group: 'Flight' },
  { id: 'rollRight', label: 'Roll right', group: 'Flight' },
  { id: 'yawLeft', label: 'Left rudder', group: 'Flight' },
  { id: 'yawRight', label: 'Right rudder', group: 'Flight' },
  { id: 'throttleUp', label: 'Throttle up', group: 'Engine' },
  { id: 'throttleDown', label: 'Throttle down', group: 'Engine' },
  { id: 'throttleFull', label: 'Full throttle', group: 'Engine' },
  { id: 'throttleCut', label: 'Cut throttle', group: 'Engine' },
  { id: 'blip', label: 'Blip switch (rotary)', group: 'Engine' },
  { id: 'fire', label: 'Fire guns', group: 'Weapons' },
  { id: 'clearJam', label: 'Hammer jammed gun', group: 'Weapons' },
  { id: 'nextTarget', label: 'Cycle target', group: 'Weapons' },
  { id: 'padlockNearest', label: 'Padlock nearest enemy', group: 'Weapons' },
  { id: 'viewCockpit', label: 'Cockpit view', group: 'Views' },
  { id: 'viewChase', label: 'Chase view', group: 'Views' },
  { id: 'viewFlyby', label: 'Fly-by view', group: 'Views' },
  { id: 'viewPadlock', label: 'Padlock view', group: 'Views' },
  { id: 'viewTarget', label: 'Target view', group: 'Views' },
  { id: 'lookLeft', label: 'Look left', group: 'Views' },
  { id: 'lookRight', label: 'Look right', group: 'Views' },
  { id: 'lookBack', label: 'Look behind', group: 'Views' },
  { id: 'lookUp', label: 'Look up', group: 'Views' },
  { id: 'wingmenAttack', label: 'Wingmen: attack my target', group: 'Wingmen' },
  { id: 'wingmenEngage', label: 'Wingmen: engage at will', group: 'Wingmen' },
  { id: 'wingmenFormUp', label: 'Wingmen: form up', group: 'Wingmen' },
  { id: 'wingmenCover', label: 'Wingmen: cover me', group: 'Wingmen' },
  { id: 'wingmenHome', label: 'Wingmen: return home', group: 'Wingmen' },
  { id: 'timeCompress', label: 'Time compression', group: 'Game' },
  { id: 'timeNormal', label: 'Normal time', group: 'Game' },
  { id: 'map', label: 'Map', group: 'Game' },
  { id: 'endFlight', label: 'End flight', group: 'Game' },
  { id: 'toggleHud', label: 'Toggle HUD', group: 'Game' },
  { id: 'pause', label: 'Pause / menu', group: 'Game' },
];

export const ACTION_GROUPS: ActionGroup[] = ['Flight', 'Engine', 'Weapons', 'Views', 'Wingmen', 'Game'];

/** Keys the browser/OS won't reliably hand to a page. */
export const RESERVED_CODES = new Set(['F11', 'F12', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu']);

export function actionLabel(id: string): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}

const SPECIAL: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Escape: 'Esc',
  Equal: '=',
  Minus: '−',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Bksp',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadEnter: 'Num Enter',
  NumpadDecimal: 'Num .',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** Human label for a KeyboardEvent.code. */
export function codeLabel(code: string): string {
  if (SPECIAL[code]) return SPECIAL[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export type Bindings = Record<string, string[]>;

/** Actions (other than `except`) currently bound to `code`. */
export function findConflicts(bindings: Bindings, code: string, except?: string): string[] {
  return Object.entries(bindings)
    .filter(([action, codes]) => action !== except && codes.includes(code))
    .map(([action]) => action);
}

/**
 * Bind `code` to `action` at `slot` (0 = primary, 1 = secondary).
 * Conflicting actions lose `code`; with strategy 'swap' they receive the key
 * that `action` previously had in that slot (if any), mirroring how most
 * games resolve a rebind collision. Returns a new object.
 */
export function rebind(bindings: Bindings, action: string, slot: number, code: string, strategy: 'swap' | 'clear' = 'swap'): Bindings {
  const next: Bindings = Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, [...v]]));
  const own = next[action] ?? (next[action] = []);
  const previous = own[slot];
  if (previous === code) return next;
  for (const other of findConflicts(next, code, action)) {
    const codes = next[other];
    const idx = codes.indexOf(code);
    if (strategy === 'swap' && previous && !codes.includes(previous)) codes[idx] = previous;
    else codes.splice(idx, 1);
  }
  // Remove a duplicate of `code` in the other slot of this action.
  const dup = own.indexOf(code);
  if (dup !== -1 && dup !== slot) own.splice(dup, 1);
  if (slot >= own.length) own.push(code);
  else own[slot] = code;
  return next;
}

export function unbind(bindings: Bindings, action: string, slot: number): Bindings {
  const next: Bindings = Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, [...v]]));
  next[action]?.splice(slot, 1);
  return next;
}

/** All codes bound to more than one action: code -> actions. */
export function duplicateBindings(bindings: Bindings): Map<string, string[]> {
  const byCode = new Map<string, string[]>();
  for (const [action, codes] of Object.entries(bindings))
    for (const c of codes) byCode.set(c, [...(byCode.get(c) ?? []), action]);
  for (const [c, actions] of byCode) if (actions.length < 2) byCode.delete(c);
  return byCode;
}
