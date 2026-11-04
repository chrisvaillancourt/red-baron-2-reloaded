/**
 * Standard-controller prompts for flight. The hint sentences, the Flying Manual's
 * controller table and the Flying School's pad lines are all built from `PAD_PROMPTS`.
 * Each row also records the effect it claims, which flightPrompts.test.ts checks against
 * `readGamepad` (src/game/input.ts), so the text cannot drift from the mapping.
 */
import type { EdgeAction } from './input';

/** What a control claims to do; checked against readGamepad's output. */
export type PadEffect =
  /** One edge command per button in `buttons`, in order. */
  | { commands: EdgeAction[] }
  /** A held PadFrame flag. */
  | { held: 'fire' | 'blip' | 'releaseBomb' | 'clearJam' }
  /** Left stick: roll and pitch; right stick: look. */
  | { stick: 'flight' | 'look' }
  /** The first button moves the value by `first`'s sign, the second the other way. */
  | { signed: 'yaw' | 'throttleDelta'; first: -1 | 1 };

export interface PadPrompt {
  /** Glyph shown in tables: 'RT', 'LB / RB', 'Left stick'. */
  glyph: string;
  /** The control's name in a sentence: 'RT', 'LB/RB', 'left stick'. */
  name: string;
  /** Standard-mapping button indices (none for a stick). */
  buttons: number[];
  /** Sentence fragment after `name` in the pilot's seat ('fires'). */
  pilot: string;
  /** At a gun; undefined means the same as the pilot, null means nothing to say there. */
  gunner?: string | null;
  /** In bombsight view (either seat), replacing the seat's fragment. */
  bombsight?: string;
  /** Description for the Flying Manual's table. */
  doc: string;
  effect: { pilot: PadEffect; gunner?: PadEffect; bombsight?: PadEffect };
}

export const PAD_PROMPTS: readonly PadPrompt[] = [
  { glyph: 'Left stick', name: 'left stick', buttons: [], pilot: 'flies', gunner: 'aims',
    doc: 'Pilot: pitch & roll. At a gun: aim the gun.', effect: { pilot: { stick: 'flight' }, gunner: { stick: 'flight' } } },
  { glyph: 'Right stick', name: 'right stick', buttons: [], pilot: 'looks', doc: 'Look around', effect: { pilot: { stick: 'look' } } },
  { glyph: 'LB / RB', name: 'LB/RB', buttons: [4, 5], pilot: 'steer rudder', gunner: 'change crew station',
    doc: 'Pilot: left / right rudder. At a gun: previous / next crew station.',
    effect: { pilot: { signed: 'yaw', first: -1 }, gunner: { commands: ['stationPrev', 'stationNext'] } } },
  { glyph: 'RT', name: 'RT', buttons: [7], pilot: 'fires', doc: 'Fire the guns while held', effect: { pilot: { held: 'fire' } } },
  { glyph: 'LT', name: 'LT', buttons: [6], pilot: 'blips', gunner: null, doc: 'Blip switch while held', effect: { pilot: { held: 'blip' } } },
  { glyph: 'A', name: 'A', buttons: [0], pilot: 'clears a jam', doc: 'Hammer a jammed gun', effect: { pilot: { held: 'clearJam' } } },
  { glyph: 'X', name: 'X', buttons: [2], pilot: 'cycles target', bombsight: 'held releases a bomb instead of cycling target',
    doc: 'Cycle target. In bombsight view: hold to release a bomb.',
    effect: { pilot: { commands: ['nextTarget'] }, bombsight: { held: 'releaseBomb' } } },
  { glyph: 'Y', name: 'Y', buttons: [3], pilot: 'padlocks', gunner: null, doc: 'Padlock view', effect: { pilot: { commands: ['viewPadlock'] } } },
  { glyph: 'R3', name: 'R3', buttons: [11], pilot: 'padlocks the nearest enemy', gunner: null,
    doc: 'Padlock nearest enemy', effect: { pilot: { commands: ['padlockNearest'] } } },
  { glyph: 'B', name: 'B', buttons: [1], pilot: 'selects chase view', gunner: 'returns to the pilot',
    doc: 'Pilot: chase view. At a gun: return to the pilot. On a pause card: back.',
    effect: { pilot: { commands: ['viewChase'] }, gunner: { commands: ['stationPilot'] } } },
  { glyph: 'L3', name: 'L3', buttons: [10], pilot: 'selects cockpit view', gunner: null,
    doc: 'Cockpit view', effect: { pilot: { commands: ['viewCockpit'] } } },
  { glyph: 'View / Back', name: 'View', buttons: [8], pilot: 'opens the map',
    doc: 'Open or close the map. B also closes it.', effect: { pilot: { commands: ['map'] } } },
  { glyph: 'Menu / Start', name: 'Menu', buttons: [9], pilot: 'pauses',
    doc: 'Pause. The pause card’s Flight actions lists the other commands.', effect: { pilot: { commands: ['pause'] } } },
  { glyph: 'D-pad ↑ / ↓', name: 'D-pad up/down', buttons: [12, 13], pilot: 'changes throttle', gunner: null,
    doc: 'Throttle up / down', effect: { pilot: { signed: 'throttleDelta', first: 1 } } },
  { glyph: 'D-pad ← / →', name: 'D-pad left/right', buttons: [14, 15], pilot: 'changes time compression', gunner: null,
    doc: 'Normal time / compress time', effect: { pilot: { commands: ['timeNormal', 'timeCompress'] } } },
];

/** How to reach every other command: Menu opens pause, whose card has Flight actions. */
export const FLIGHT_ACTIONS_PATH = 'For other actions, press Menu and choose Flight actions; B backs out.';

/** The fragment a row contributes in a context, or null when it has none there. */
export function padPromptText(p: PadPrompt, atGun: boolean, bombsight: boolean): string | null {
  if (bombsight && p.bombsight) return p.bombsight;
  return atGun && p.gunner !== undefined ? p.gunner : p.pilot;
}

/** The effect a row claims in a context (the one its text describes). */
export function padPromptEffect(p: PadPrompt, atGun: boolean, bombsight: boolean): PadEffect {
  if (bombsight && p.bombsight && p.effect.bombsight) return p.effect.bombsight;
  return (atGun && p.effect.gunner) || p.effect.pilot;
}

const prefix = (atGun: boolean, bombsight: boolean) =>
  bombsight ? (atGun ? 'At the gunner’s bombsight' : 'Pilot in bombsight view') : atGun ? 'Gunner' : 'Pilot';

/** The standard-controller hint for the current flight control context. */
export function controllerFlightHint(atGun: boolean, bombsight: boolean): string {
  const parts: string[] = [];
  for (const p of PAD_PROMPTS) {
    const text = padPromptText(p, atGun, bombsight);
    if (text) parts.push(`${p.name} ${text}`);
  }
  return `${prefix(atGun, bombsight)}: ${parts.join('; ')}. ${FLIGHT_ACTIONS_PATH}`;
}
