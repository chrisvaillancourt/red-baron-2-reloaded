import type { EdgeAction } from '../game/input';
import type { TouchControls, TouchControlSink, TouchControlView, TouchInputState } from '../game/touchInput';
import { h } from './dom';
import './touchControls.css';

type Gesture = 'stick' | 'look' | 'rudderLeft' | 'rudderRight' | 'fire' | 'blip';
interface Owner { element: HTMLElement; gesture: Gesture; x: number; y: number }

const ACTION_GROUPS: { label: string; actions: [EdgeAction, string][] }[] = [
  { label: 'Views & targets', actions: [
    ['viewCockpit', 'Cockpit view'], ['viewChase', 'Chase view'], ['viewPadlock', 'Padlock view'],
    ['viewTarget', 'Target view'], ['viewFlyby', 'Fly-by view'], ['nextTarget', 'Next target'], ['padlockNearest', 'Nearest enemy'],
  ] },
  { label: 'Navigation & time', actions: [['map', 'Map'], ['timeNormal', 'Normal time'], ['timeCompress', 'Compress time']] },
  { label: 'Crew & weapons', actions: [
    ['stationNext', 'Next crew station'], ['stationPrev', 'Previous crew station'], ['stationPilot', 'Pilot station'],
    ['viewBombsight', 'Bombsight'], ['releaseBomb', 'Release bomb'], ['clearJam', 'Clear gun jam'],
  ] },
  { label: 'Engine', actions: [['throttleFull', 'Full throttle'], ['throttleCut', 'Cut throttle']] },
  { label: 'Wingmen', actions: [
    ['wingmenAttack', 'Attack my target'], ['wingmenEngage', 'Engage enemies'], ['wingmenFormUp', 'Form up'],
    ['wingmenCover', 'Cover me'], ['wingmenHome', 'Return home'],
  ] },
  { label: 'Flight', actions: [['toggleHud', 'Show / hide HUD'], ['endFlight', 'End flight']] },
];

/** Gesture ownership lives here; normalized rates and commands cross the game seam. */
export function createTouchControls(container: HTMLElement, sink: TouchControlSink): TouchControls {
  const abort = new AbortController();
  const coarse = window.matchMedia('(any-pointer: coarse)');
  let touchCapable = coarse.matches || navigator.maxTouchPoints > 0;
  let preference: boolean | null = null;
  let enabled = false;
  let disposed = false;
  let sheetOpen = false;
  let epoch = 0;
  let view: TouchControlView = { active: false, blocked: true, throttle: 0, stationLabel: 'Pilot', hasCrew: false, hasBombs: false };
  const owners = new Map<number, Owner>();
  const keyHolds = new Set<Gesture>();
  const throttlePointers = new Set<number>();
  let throttleKeyboard = false;
  const heldButtons = new Map<Gesture, HTMLButtonElement>();
  const pendingClicks = new Map<HTMLButtonElement, { pointer: number; epoch: number; ready: boolean }>();
  const root = h('div', { class: 'rb-touch-controls', dataset: { touch: 'controls' }, 'aria-label': 'Touch flight controls' });
  const menu = h('button', { type: 'button', dataset: { touch: 'menu' }, 'aria-expanded': 'false' }, 'Menu');
  const toggle = h('button', { type: 'button', class: 'touch-toggle', dataset: { touch: 'toggle' }, 'aria-pressed': 'false' }, 'Touch controls');
  const station = h('span', { class: 'touch-station', dataset: { touch: 'station' } }, 'Pilot');
  const toolbar = h('div', { class: 'touch-toolbar' }, menu, station, toggle);
  const stickDot = h('span', { class: 'touch-pad-dot', 'aria-hidden': 'true' });
  const lookDot = h('span', { class: 'touch-pad-dot', 'aria-hidden': 'true' });
  const stick = h('div', { class: 'touch-pad touch-stick', dataset: { touch: 'stick' }, role: 'group', 'aria-label': 'Flight stick or gun aim' }, h('span', { class: 'touch-pad-label' }, 'Stick / aim'), stickDot);
  const look = h('div', { class: 'touch-pad touch-look', dataset: { touch: 'look' }, role: 'group', 'aria-label': 'Look around' }, h('span', { class: 'touch-pad-label' }, 'Look'), lookDot);
  const holdButton = (gesture: Gesture, label: string) => {
    const button = h('button', { type: 'button', class: 'touch-hold', dataset: { touch: gesture }, 'aria-pressed': 'false' }, label);
    heldButtons.set(gesture, button);
    return button;
  };
  const rudders = h('div', { class: 'touch-rudders' }, holdButton('rudderLeft', 'Rudder left'), holdButton('rudderRight', 'Rudder right'));
  const fire = holdButton('fire', 'Fire');
  const blip = holdButton('blip', 'Blip');
  const throttleValue = h('output', { dataset: { touch: 'throttle-value' } }, '0%');
  const throttle = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '0', dataset: { touch: 'throttle' }, 'aria-label': 'Throttle' });
  const throttleBox = h('label', { class: 'touch-throttle' }, h('span', null, 'Throttle ', throttleValue), throttle);
  const flight = h('div', { class: 'touch-flight', dataset: { touch: 'flight' } },
    h('div', { class: 'touch-left' }, stick, rudders),
    h('div', { class: 'touch-right' }, h('div', { class: 'touch-weapons' }, fire, blip), look, throttleBox));
  const cancelButton = h('button', { type: 'button', dataset: { touch: 'resume' } }, 'Return to flight');
  const sheetBody = h('div', { class: 'touch-sheet-body' });
  const sheet = h('section', { class: 'touch-sheet', dataset: { touch: 'sheet' }, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Flight actions' },
    h('header', null, h('h2', null, 'Flight actions'), h('p', null, 'Flight paused while this menu is open.')),
    sheetBody, h('footer', null, cancelButton));
  const backdrop = h('div', { class: 'touch-sheet-backdrop' }, sheet);
  backdrop.hidden = true;
  root.append(toolbar, flight, backdrop);
  container.append(root);

  function listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler, { signal: abort.signal });
  }
  const canFly = () => enabled && !view.blocked && !sheetOpen && !disposed;
  function publish(): void {
    let stickX = 0, stickY = 0, lookX = 0, lookY = 0;
    let left = keyHolds.has('rudderLeft'), right = keyHolds.has('rudderRight');
    let fireHeld = keyHolds.has('fire'), blipHeld = keyHolds.has('blip');
    for (const owner of owners.values()) {
      if (owner.gesture === 'stick') { stickX = owner.x; stickY = owner.y; }
      if (owner.gesture === 'look') { lookX = owner.x; lookY = owner.y; }
      if (owner.gesture === 'rudderLeft') left = true;
      if (owner.gesture === 'rudderRight') right = true;
      if (owner.gesture === 'fire') fireHeld = true;
      if (owner.gesture === 'blip') blipHeld = true;
    }
    const state: TouchInputState = { stickX, stickY, lookX, lookY, rudder: Number(right) - Number(left), fire: fireHeld, blip: blipHeld };
    sink.state(state);
    stickDot.style.transform = `translate(${stickX * 36}px, ${stickY * 36}px)`;
    lookDot.style.transform = `translate(${lookX * 28}px, ${lookY * 28}px)`;
    for (const [gesture, button] of heldButtons) {
      const held = gesture === 'fire' ? fireHeld : gesture === 'blip' ? blipHeld : gesture === 'rudderLeft' ? left : right;
      button.setAttribute('aria-pressed', String(held));
    }
  }
  function clearGestures(): void {
    epoch++;
    pendingClicks.clear();
    const captures = Array.from(owners.entries());
    owners.clear();
    keyHolds.clear();
    throttlePointers.clear();
    throttleKeyboard = false;
    publish();
    sink.cancel();
    for (const [id, owner] of captures) {
      if (owner.element.hasPointerCapture(id)) owner.element.releasePointerCapture(id);
    }
  }
  function closeSheet(focus = false): void {
    if (!sheetOpen) return;
    sheetOpen = false;
    backdrop.hidden = true;
    menu.setAttribute('aria-expanded', 'false');
    sink.capture(false);
    render();
    if (focus && view.active) menu.focus();
  }
  function cancel(): void {
    if (disposed) return;
    clearGestures();
    closeSheet();
  }
  function render(): void {
    root.hidden = !view.active;
    menu.hidden = !enabled && !touchCapable;
    station.hidden = !enabled;
    menu.textContent = sheetOpen ? 'Return to flight' : view.blocked ? 'Return to flight' : 'Menu';
    flight.hidden = !canFly();
    flight.inert = !canFly();
    throttle.disabled = !canFly();
    toggle.hidden = sheetOpen;
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Hide touch controls' : 'Touch controls';
    container.classList.toggle('rb-touch-active', enabled && !view.blocked && !sheetOpen);
    container.classList.toggle('rb-touch-menu-available', view.active && (enabled || touchCapable));
    root.classList.toggle('touch-capable', touchCapable);
    root.classList.toggle('touch-enabled', enabled);
  }
  function syncActive(): void {
    const next = view.active && (preference ?? touchCapable);
    if (next !== enabled) {
      clearGestures();
      closeSheet();
      enabled = next;
      sink.active(enabled);
    }
    render();
  }
  function axis(owner: Owner, event: PointerEvent): void {
    if (owner.gesture !== 'stick' && owner.gesture !== 'look') return;
    const rect = owner.element.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2 - 12);
    let x = (event.clientX - rect.left - rect.width / 2) / radius;
    let y = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    // Small neutral zone without changing the screen-axis convention.
    owner.x = Math.abs(x) < 0.08 ? 0 : x;
    owner.y = Math.abs(y) < 0.08 ? 0 : y;
  }
  function bindGesture(element: HTMLElement, gesture: Gesture): void {
    listen(element, 'pointerdown', (raw) => {
      const event = raw as PointerEvent;
      if (!canFly() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      sink.gesture();
      const owner: Owner = { element, gesture, x: 0, y: 0 };
      owners.set(event.pointerId, owner);
      element.setPointerCapture(event.pointerId);
      axis(owner, event);
      publish();
    });
    listen(element, 'pointermove', (raw) => {
      const event = raw as PointerEvent;
      const owner = owners.get(event.pointerId);
      if (!owner || owner.element !== element) return;
      event.preventDefault();
      axis(owner, event);
      publish();
    });
    const release: EventListener = (raw) => {
      const event = raw as PointerEvent;
      const owner = owners.get(event.pointerId);
      if (!owner || owner.element !== element) return;
      owners.delete(event.pointerId);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      publish();
    };
    listen(element, 'pointerup', release);
    listen(element, 'pointercancel', release);
    listen(element, 'lostpointercapture', release);
    if (element instanceof HTMLButtonElement) {
      listen(element, 'keydown', (raw) => {
        const event = raw as KeyboardEvent;
        if (!canFly() || (event.key !== ' ' && event.key !== 'Enter')) return;
        event.preventDefault();
        sink.gesture();
        keyHolds.add(gesture);
        publish();
      });
      listen(element, 'keyup', (raw) => {
        const event = raw as KeyboardEvent;
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        keyHolds.delete(gesture);
        publish();
      });
      listen(element, 'blur', () => { if (keyHolds.delete(gesture)) publish(); });
      listen(element, 'click', (event) => event.preventDefault());
    }
  }
  // Native button activation preserves scrolling and keyboard access. Pointer clicks
  // additionally need an uncancelled down/up pair from this lifecycle generation.
  function bindAction(button: HTMLButtonElement, action: () => void): void {
    listen(button, 'pointerdown', (raw) => {
      const event = raw as PointerEvent;
      if (event.button !== 0) return;
      pendingClicks.set(button, { pointer: event.pointerId, epoch, ready: false });
      sink.gesture();
    });
    listen(button, 'pointerup', (raw) => {
      const event = raw as PointerEvent;
      const pending = pendingClicks.get(button);
      if (!pending || pending.pointer !== event.pointerId) return;
      const rect = button.getBoundingClientRect();
      pending.ready = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    const discard: EventListener = () => { pendingClicks.delete(button); };
    listen(button, 'pointercancel', discard);
    listen(button, 'lostpointercapture', () => {
      // Touch buttons have implicit capture. Its normal release follows pointerup
      // but precedes click; only premature loss invalidates native activation.
      if (!pendingClicks.get(button)?.ready) pendingClicks.delete(button);
    });
    listen(button, 'click', (raw) => {
      const event = raw as MouseEvent;
      const pending = pendingClicks.get(button);
      pendingClicks.delete(button);
      if (disposed || !view.active || (event.detail !== 0 && (!pending?.ready || pending.epoch !== epoch))) return;
      sink.gesture();
      action();
    });
  }
  bindGesture(stick, 'stick');
  bindGesture(look, 'look');
  for (const [gesture, button] of heldButtons) bindGesture(button, gesture);
  bindAction(toggle, () => { preference = !enabled; syncActive(); });
  bindAction(menu, () => {
    if (!enabled && !touchCapable) return;
    if (sheetOpen) { clearGestures(); closeSheet(true); return; }
    if (view.blocked) { clearGestures(); sink.command('pause'); return; }
    clearGestures();
    sheetOpen = true;
    backdrop.hidden = false;
    menu.setAttribute('aria-expanded', 'true');
    sink.capture(true);
    render();
    cancelButton.focus();
  });
  bindAction(cancelButton, () => { clearGestures(); closeSheet(true); });
  for (const group of ACTION_GROUPS) {
    const buttons = group.actions.map(([action, label]) => {
      const button = h('button', { type: 'button', dataset: { touchAction: action } }, label);
      bindAction(button, () => {
        if (!sheetOpen) return;
        clearGestures();
        closeSheet(); // Release the menu's pause before session.command sees intent.
        sink.command(action);
      });
      return button;
    });
    sheetBody.append(h('section', { class: 'touch-action-group' }, h('h3', null, group.label), h('div', { class: 'touch-action-grid' }, ...buttons)));
  }
  listen(throttle, 'pointerdown', (raw) => {
    if (!canFly()) return;
    throttlePointers.add((raw as PointerEvent).pointerId);
    sink.gesture();
  });
  const releaseThrottle: EventListener = (raw) => { throttlePointers.delete((raw as PointerEvent).pointerId); };
  listen(window, 'pointerup', releaseThrottle);
  listen(window, 'pointercancel', releaseThrottle);
  listen(throttle, 'lostpointercapture', releaseThrottle);
  listen(throttle, 'keydown', () => { throttleKeyboard = true; sink.gesture(); });
  listen(throttle, 'keyup', () => { throttleKeyboard = false; });
  listen(throttle, 'blur', () => { throttleKeyboard = false; });
  listen(throttle, 'input', () => {
    if (!canFly() || (!throttlePointers.size && !throttleKeyboard)) return;
    sink.throttle(throttle.valueAsNumber / 100);
  });
  listen(root, 'pointerdown', (event) => event.stopPropagation());
  listen(root, 'click', (event) => event.stopPropagation());
  listen(root, 'keydown', (raw) => {
    const event = raw as KeyboardEvent;
    event.stopPropagation();
    if (sheetOpen && event.key === 'Escape') { event.preventDefault(); cancel(); menu.focus(); }
    if (sheetOpen && event.key === 'Tab') {
      const buttons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  listen(root, 'keyup', (event) => event.stopPropagation());
  // Compatibility mouse events must not lock the canvas or fire a desktop gun
  // when the user hides touch gestures but still uses the persistent menu.
  for (const type of ['mousedown', 'mouseup', 'mousemove', 'wheel']) {
    listen(root, type, (event) => event.stopPropagation());
  }
  listen(window, 'blur', cancel);
  listen(window, 'resize', cancel);
  listen(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  listen(coarse, 'change', () => { touchCapable = coarse.matches || navigator.maxTouchPoints > 0; syncActive(); });
  listen(window, 'pointerdown', (raw) => {
    if ((raw as PointerEvent).pointerType === 'touch' && !touchCapable) { touchCapable = true; syncActive(); }
  });
  render();
  return {
    update(next) {
      if (disposed) return;
      if ((!view.blocked && next.blocked) || (view.active && !next.active) || next.stationLabel !== view.stationLabel) cancel();
      view = next;
      station.textContent = next.stationLabel;
      const percent = Math.round(Math.max(0, Math.min(1, next.throttle)) * 100);
      throttle.value = String(percent);
      throttleValue.value = `${percent}%`;
      for (const button of sheetBody.querySelectorAll<HTMLButtonElement>('[data-touch-action]')) {
        const action = button.dataset.touchAction;
        button.disabled = (action?.startsWith('station') && !next.hasCrew) || ((action === 'viewBombsight' || action === 'releaseBomb') && !next.hasBombs);
      }
      syncActive();
    },
    cancel,
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      abort.abort();
      if (enabled) sink.active(false);
      container.classList.remove('rb-touch-active', 'rb-touch-menu-available');
      root.remove();
    },
  };
}
