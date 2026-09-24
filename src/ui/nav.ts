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
}

export interface Nav {
  setActive(active: boolean): void;
  focusFirst(scope?: HTMLElement | null): void;
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

  function move(dir: Dir): void {
    const scope = opts.scope();
    if (!scope) return;
    const items = focusables(scope);
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !scope.contains(cur) || cur === document.body) {
      items[0].focus();
      return;
    }
    const cands = items.filter((e) => e !== cur).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const next = pickSpatial(cur.getBoundingClientRect(), cands, dir);
    if (next) {
      next.focus();
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

  function press(id: string, now: number, held: boolean, action: () => void): void {
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
    // auto-repeat after 400 ms, every 120 ms
    if (now - since > 400 && now - (lastPress.get(id) ?? 0) > 120) {
      lastPress.set(id, now);
      action();
    }
  }

  function pollGamepads(now: number): void {
    raf = requestAnimationFrame(pollGamepads);
    if (!active || !navigator.getGamepads) return;
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const k = `${gp.index}:`;
      press(k + 'up', now, b(12) || ay < -0.6, () => move('up'));
      press(k + 'down', now, b(13) || ay > 0.6, () => move('down'));
      press(k + 'left', now, b(14) || ax < -0.6, () => move('left'));
      press(k + 'right', now, b(15) || ax > 0.6, () => move('right'));
      press(k + 'a', now, b(0), () => {
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body) el.click();
        else move('down');
      });
      press(k + 'b', now, b(1), () => opts.onBack());
      press(k + 'lb', now, b(4), () => opts.onTab(-1));
      press(k + 'rb', now, b(5), () => opts.onTab(1));
    }
  }

  window.addEventListener('keydown', onKey);
  raf = requestAnimationFrame(pollGamepads);

  return {
    setActive(a) {
      active = a;
    },
    focusFirst(scope = opts.scope()) {
      if (!scope) return;
      const auto = scope.querySelector<HTMLElement>('[data-autofocus]');
      const all = focusables(scope);
      // Prefer content over the header's Back button.
      const target = auto && visible(auto) ? auto : (all.find((e) => !e.closest('.rb-header')) ?? all[0]);
      target?.focus({ preventScroll: true });
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    },
  };
}
