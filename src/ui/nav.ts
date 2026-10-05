/**
 * Keyboard + gamepad focus navigation for menu screens.
 *
 *  - Arrow keys / D-pad / left stick: spatial focus movement.
 *  - Enter / Space / A: activate focused control (native for buttons).
 *  - Escape / Backspace / B: back.
 *  - [ / ] / PageUp / PageDown / LB / RB: previous / next tab.
 *
 * Disabled while a flight is running (the game owns input then).
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface NavOptions {
  /** Current navigation scope (top-most modal, else the active screen). */
  scope: () => HTMLElement | null;
  onBack: () => void;
  onTab: (dir: -1 | 1) => void;
  /** Optional contextual controller gate; keyboard navigation is unaffected. */
  gamepadEnabled?: () => boolean;
  /** Contextual ownership filter; unspecified preserves legacy menu mappings. */
  gamepadAllowed?: (pad: Gamepad) => boolean;
  /** Leave Escape/Backspace to a session's pause bindings instead of onBack. */
  keyboardBack?: boolean;
}

export interface Nav {
  setActive(active: boolean): void;
  /** Restore a focusable target only within the current owner; otherwise its default. */
  focusFirst(preferred?: HTMLElement | null): void;
  dispose(): void;
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusables(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

type Dir = 'up' | 'down' | 'left' | 'right';

/** Pick the best candidate in `dir` from `from` (spatial navigation). */
export function pickSpatial(from: DOMRect, candidates: { el: HTMLElement; r: DOMRect }[], dir: Dir): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r } of candidates) {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    let primary: number;
    let ortho: number;
    switch (dir) {
      case 'up':
        primary = -dy;
        ortho = Math.abs(dx);
        break;
      case 'down':
        primary = dy;
        ortho = Math.abs(dx);
        break;
      case 'left':
        primary = -dx;
        ortho = Math.abs(dy);
        break;
      case 'right':
        primary = dx;
        ortho = Math.abs(dy);
        break;
    }
    if (primary <= 2) continue;
    const score = primary + ortho * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function createNav(opts: NavOptions): Nav {
  let active = true;
  let raf = 0;
  const lastPress = new Map<string, number>();
  const heldSince = new Map<string, number>();
  const pads = new Map<number, { id: string; armed: boolean }>();
  let padScope: HTMLElement | null = null;
  let generation = 0;
  let highlighted: HTMLElement | null = null;

  function clearFocus(): void {
    highlighted?.classList.remove('nav-focus');
    highlighted = null;
  }

  function focusElement(el: HTMLElement, preventScroll = false): void {
    el.focus({ preventScroll });
    if (document.activeElement !== el) return;
    clearFocus();
    el.classList.add('nav-focus');
    highlighted = el;
  }

  function onFocusOut(event: FocusEvent): void {
    if (event.target === highlighted) clearFocus();
  }

  function resetGamepads(): void {
    lastPress.clear();
    heldSince.clear();
    pads.clear();
    padScope = null;
    generation++;
  }

  function forgetPad(index: number): void {
    const prefix = `${index}:`;
    for (const key of heldSince.keys()) if (key.startsWith(prefix)) heldSince.delete(key);
    for (const key of lastPress.keys()) if (key.startsWith(prefix)) lastPress.delete(key);
    pads.delete(index);
  }

  function onConnectionChange(event: GamepadEvent): void {
    forgetPad(event.gamepad.index);
    generation++;
  }

  function move(dir: Dir): void {
    const scope = opts.scope();
    if (!scope) return;
    const items = focusables(scope);
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !scope.contains(cur) || cur === document.body) {
      focusElement(items[0]);
      return;
    }
    // Left/right inside a segmented group steps through it in order, even where it wraps onto
    // two rows (spatially the button below can be nearer than the next one along).
    const seg = dir === 'left' || dir === 'right' ? cur.closest<HTMLElement>('.seg') : null;
    if (seg && scope.contains(seg)) {
      const btns = focusables(seg);
      const sib = btns[btns.indexOf(cur) + (dir === 'right' ? 1 : -1)];
      if (sib) {
        focusElement(sib);
        return;
      }
    }
    const cands = items.filter((e) => e !== cur).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const next = pickSpatial(cur.getBoundingClientRect(), cands, dir);
    if (next) {
      focusElement(next);
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    // Nothing further that way: scroll the nearest scrollable ancestor instead.
    const dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    if (!dy) return;
    for (let el: HTMLElement | null = cur; el && el !== scope.parentElement; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') {
        el.scrollBy({ top: dy * el.clientHeight * 0.35, behavior: 'smooth' });
        return;
      }
    }
  }

  function isTextEntry(el: Element | null): boolean {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) return ['text', 'search', 'email', 'number', 'password'].includes(el.type);
    return false;
  }

  function onKey(e: KeyboardEvent): void {
    if (!active || e.defaultPrevented) return;
    if (opts.keyboardBack === false && (e.key === 'Escape' || e.key === 'Backspace')) return;
    const t = document.activeElement;
    const text = isTextEntry(t);
    const range = t instanceof HTMLInputElement && t.type === 'range';
    const select = t instanceof HTMLSelectElement;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (select) return;
        e.preventDefault();
        move(e.key === 'ArrowUp' ? 'up' : 'down');
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (text || range || select) return;
        e.preventDefault();
        move(e.key === 'ArrowLeft' ? 'left' : 'right');
        break;
      case 'Escape':
        e.preventDefault();
        if (text) (t as HTMLElement).blur();
        opts.onBack();
        break;
      case 'Backspace':
        if (text) return;
        e.preventDefault();
        opts.onBack();
        break;
      case 'PageUp':
        e.preventDefault();
        opts.onTab(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        opts.onTab(1);
        break;
      default:
        if (!text && (e.key === '[' || e.key === ']')) {
          opts.onTab(e.key === '[' ? -1 : 1);
        }
    }
  }

  function press(id: string, now: number, held: boolean, action: () => void, repeat = true): void {
    if (!held) {
      heldSince.delete(id);
      return;
    }
    const since = heldSince.get(id);
    if (since === undefined) {
      heldSince.set(id, now);
      lastPress.set(id, now);
      action();
      return;
    }
    // Direction/tab holds repeat after 400 ms, every 120 ms; activation is an edge.
    if (repeat && now - since > 400 && now - (lastPress.get(id) ?? 0) > 120) {
      lastPress.set(id, now);
      action();
    }
  }

  function pollGamepads(now: number): void {
    raf = requestAnimationFrame(pollGamepads);
    const scope = opts.scope();
    if (!active || !scope || document.hidden || !document.hasFocus() || opts.gamepadEnabled?.() === false || !navigator.getGamepads) {
      resetGamepads();
      return;
    }
    if (scope !== padScope) {
      resetGamepads();
      padScope = scope;
      if (highlighted && !scope.contains(highlighted)) clearFocus();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && scope.contains(focused)) focusElement(focused, true);
    }
    const connected = navigator.getGamepads();
    for (const [index, state] of pads) {
      if (!connected[index]?.connected || connected[index]?.id !== state.id) forgetPad(index);
    }
    for (const gp of connected) {
      if (!gp || !gp.connected || opts.gamepadAllowed?.(gp) === false) continue;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      let state = pads.get(gp.index);
      if (!state) {
        state = { id: gp.id, armed: false };
        pads.set(gp.index, state);
      }
      // A held activation/direction cannot cross a menu, modal or session handoff.
      if (!state.armed) {
        if (!gp.buttons.some(button => button.pressed || button.value > 0.4) && Math.abs(ax) < 0.6 && Math.abs(ay) < 0.6) state.armed = true;
        continue;
      }
      const k = `${gp.index}:`;
      const owner = generation;
      press(k + 'up', now, b(12) || ay < -0.6, () => move('up'));
      press(k + 'down', now, b(13) || ay > 0.6, () => move('down'));
      press(k + 'left', now, b(14) || ax < -0.6, () => move('left'));
      press(k + 'right', now, b(15) || ax > 0.6, () => move('right'));
      press(k + 'a', now, b(0), () => {
        const el = document.activeElement as HTMLElement | null;
        if (el && scope.contains(el)) el.click();
        else move('down');
      }, false);
      if (!active || opts.scope() !== scope || generation !== owner) { resetGamepads(); return; }
      press(k + 'b', now, b(1), () => opts.onBack());
      if (!active || opts.scope() !== scope || generation !== owner) { resetGamepads(); return; }
      press(k + 'lb', now, b(4), () => opts.onTab(-1));
      press(k + 'rb', now, b(5), () => opts.onTab(1));
    }
  }

  window.addEventListener('keydown', onKey);
  window.addEventListener('focusout', onFocusOut);
  window.addEventListener('pointerdown', clearFocus);
  window.addEventListener('blur', clearFocus);
  window.addEventListener('gamepaddisconnected', onConnectionChange);
  window.addEventListener('gamepadconnected', onConnectionChange);
  raf = requestAnimationFrame(pollGamepads);

  return {
    setActive(a) {
      active = a;
      resetGamepads();
      if (!a) clearFocus();
    },
    focusFirst(preferred) {
      const scope = opts.scope();
      if (!active || !scope) return;
      const auto = scope.querySelector<HTMLElement>('[data-autofocus]');
      const all = focusables(scope);
      // Restore only inside the owner; otherwise prefer content over header Back.
      const target = preferred && all.includes(preferred) ? preferred : auto && all.includes(auto) ? auto : (all.find((e) => !e.closest('.rb-header')) ?? all[0]);
      if (target) focusElement(target, true);
    },
    dispose() {
      active = false;
      resetGamepads();
      clearFocus();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('pointerdown', clearFocus);
      window.removeEventListener('blur', clearFocus);
      window.removeEventListener('gamepaddisconnected', onConnectionChange);
      window.removeEventListener('gamepadconnected', onConnectionChange);
      cancelAnimationFrame(raf);
    },
  };
}
