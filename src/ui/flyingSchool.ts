/**
 * "Flying School" card: a one-page primer shown before the first flight on
 * this browser (and whenever tutorial hints are on and it hasn't been seen).
 * Keys are read from the live bindings so the card never disagrees with them.
 */
import type { UiContext } from './context';
import { h } from './dom';
import { codeLabel } from './bindings';

const SEEN_KEY = 'rb2r.flyingSchool.seen.v1';

function seen(): boolean {
  try {
    return globalThis.localStorage?.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable: the card shows again next time */
  }
}

export function shouldShowFlyingSchool(ctx: UiContext): boolean {
  return ctx.settings().showTutorialHints && !seen();
}

/** Show the card if due; resolves once the pilot has read it (or immediately). */
export async function maybeShowFlyingSchool(ctx: UiContext): Promise<void> {
  if (!shouldShowFlyingSchool(ctx)) return;
  await showFlyingSchool(ctx);
  markSeen();
}

export function showFlyingSchool(ctx: UiContext): Promise<boolean> {
  const s = ctx.settings();
  const b = s.controls.keyBindings;
  const keys = (action: string, max = 2) => {
    const codes = (b[action] ?? []).slice(0, max);
    return codes.length ? codes.flatMap((c, i) => [i ? ' ' : '', h('kbd', null, codeLabel(c))]) : [h('kbd', null, 'unbound')];
  };
  /** The four stick keys from binding slot `i` (primary arrows, alternate WASD). */
  const stickKeys = (i: number) =>
    ['pitchDown', 'pitchUp', 'rollLeft', 'rollRight'].flatMap((a) => {
      const c = b[a]?.[i];
      return c ? [h('kbd', null, codeLabel(c))] : [];
    });
  const mouseAim = s.controls.mouseMode === 'mouse-aim';

  const lesson = (n: string, title: string, text: Node | string, ...k: (Node | string)[]) =>
    h('div', { class: 'fs-lesson' }, h('div', { class: 'fs-n' }, n), h('div', null, h('h3', null, title), h('p', null, text), k.length ? h('div', { class: 'fs-keys' }, ...k) : null));

  const body = h(
    'div',
    { class: 'flying-school' },
    h('p', { class: 'typed fs-intro' }, 'Before you go up, a word from the instructor. Read it again at any time in the Flying Manual.'),
    h(
      'div',
      { class: 'fs-grid' },
      lesson(
        'I',
        'Flying',
        mouseAim
          ? 'Move the mouse and your machine turns towards the aiming circle — just point where you want to go. The stick keys fly by hand and take over from the mouse.'
          : 'Fly the stick with the keys. Pull back to climb, bank to turn; an aeroplane turns by banking, not by rudder.',
        ...stickKeys(0),
        ' or ',
        ...stickKeys(1),
      ),
      lesson('II', 'Engine', 'Throttle up for the climb, back for the glide. A rotary engine runs flat out: blip the ignition to slow down.', ...keys('throttleUp', 1), ' ', ...keys('throttleDown', 1), ' ', ...keys('blip', 1), ' · mouse wheel'),
      lesson('III', 'Guns', 'Fire in short bursts from close range — the guns converge at about 150 m. If a gun jams, hammer the breech until it clears.', ...keys('fire', 1), ' · left button · jam ', ...keys('clearJam', 1)),
      lesson('IV', 'Keep your eyes on him', 'Padlock view turns your head to follow the enemy. Cycle targets to choose which one.', ...keys('viewPadlock', 1), ' padlock · ', ...keys('nextTarget', 1), ' next target'),
      lesson('V', 'Views', 'The cockpit is where the fighting is done; the outside views help you learn your machine.', ...keys('viewCockpit', 1), ' cockpit · ', ...keys('viewChase', 1), ' chase'),
      lesson('VI', 'Coming home', 'Land at your aerodrome, or end the flight over friendly ground when no enemy is near. The map shows your route.', ...keys('endFlight', 1), ' end flight · ', ...keys('map', 1), ' map · ', ...keys('pause', 1), ' pause'),
    ),
  );

  return ctx.confirm({ title: 'Flying School', body, confirmLabel: 'Understood — take off', infoOnly: true, className: 'wide' });
}
