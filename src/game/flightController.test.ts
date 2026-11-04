import { describe, expect, it } from 'vitest';
import type { HudControllerOptions } from '../ui/hud/types';
import { bindFlightController, ControllerHint } from './flightController';
import { controllerFlightHint } from './flightPrompts';
import type { EdgeAction } from './input';

function fakeHud() {
  const calls: (HudControllerOptions | null)[] = [];
  return {
    calls,
    get options() { return calls[calls.length - 1] ?? null; },
    setControllerOptions: (o: HudControllerOptions | null) => { calls.push(o); },
  };
}
const gp = (index: number, id: string) => ({ index, id, mapping: 'standard', connected: true }) as unknown as Gamepad;

function bind(owner: { index: number; id: string } | null = { index: 2, id: 'menu' }, overlay: HTMLElement | null = null) {
  const hud = fakeHud();
  const dispatched: EdgeAction[] = [];
  const state = { owner, overlay, captures: true };
  const unbind = bindFlightController({
    hud,
    owner: () => state.owner,
    dispatch: (a) => dispatched.push(a),
    foregroundOverlay: () => state.overlay,
    mapCapturesInput: () => state.captures,
  });
  return { hud, dispatched, state, unbind, options: hud.options! };
}

describe('flight controller binding', () => {
  it('allows only the input owner pad, by index and id', () => {
    const { options, state } = bind();
    expect(options.gamepadAllowed(gp(2, 'menu'))).toBe(true);
    expect(options.gamepadAllowed(gp(0, 'menu'))).toBe(false);
    expect(options.gamepadAllowed(gp(2, 'other'))).toBe(false);
    state.owner = null;
    expect(options.gamepadAllowed(gp(2, 'menu'))).toBe(false);
  });

  it('dispatches each action exactly once and exposes the foreground overlay', () => {
    const overlay = {} as HTMLElement;
    const { options, dispatched } = bind(undefined, overlay);
    options.onAction('viewChase');
    options.onAction('wingmenCover');
    expect(dispatched).toEqual(['viewChase', 'wingmenCover']);
    expect(options.foregroundOverlay()).toBe(overlay);
  });

  it('clears the HUD options on unbind and ignores callbacks afterwards', () => {
    const { hud, options, dispatched, unbind } = bind(undefined, {} as HTMLElement);
    unbind();
    expect(hud.calls.at(-1)).toBeNull();
    options.onAction('map');
    expect(dispatched).toEqual([]);
    expect(options.gamepadAllowed(gp(2, 'menu'))).toBe(false);
    expect(options.foregroundOverlay()).toBeNull();
    expect(options.mapCapturesInput()).toBe(false);
    unbind();
    expect(hud.calls.filter((c) => c === null)).toHaveLength(1);
  });

  it('turns a stale session into a no-op once a newer session binds', () => {
    const stale = bind();
    const fresh = bind();
    stale.options.onAction('pause');
    expect(stale.dispatched).toEqual([]);
    expect(stale.options.gamepadAllowed(gp(2, 'menu'))).toBe(false);
    fresh.options.onAction('pause');
    expect(fresh.dispatched).toEqual(['pause']);
    // The stale session's own teardown still clears its HUD without revoking the fresh one.
    stale.unbind();
    expect(stale.hud.calls.at(-1)).toBeNull();
    fresh.options.onAction('map');
    expect(fresh.dispatched).toEqual(['pause', 'map']);
  });
});

describe('contextual controller hint', () => {
  it('shows the pilot hint at the start of the flight, then hides it', () => {
    const hint = new ControllerHint();
    expect(hint.update(0, true, false, false)).toBe(controllerFlightHint(false, false));
    expect(hint.update(19, true, false, false)).toBe(controllerFlightHint(false, false));
    expect(hint.update(25, true, false, false)).toBeNull();
  });

  it('shows again for a while after a station or bombsight change', () => {
    const hint = new ControllerHint();
    hint.update(0, true, false, false);
    expect(hint.update(60, true, true, false)).toBe(controllerFlightHint(true, false));
    expect(hint.update(65, true, true, true)).toBe(controllerFlightHint(true, true));
    expect(hint.update(65 + ControllerHint.CHANGE_SECONDS + 1, true, true, true)).toBeNull();
    expect(hint.update(200, true, false, true)).toBe(controllerFlightHint(false, true));
  });

  it('returns null without an enabled standard pad', () => {
    const hint = new ControllerHint();
    expect(hint.update(0, false, false, false)).toBeNull();
    // A pad that connects later still gets the current context's hint.
    expect(hint.update(40, true, false, false)).toBe(controllerFlightHint(false, false));
  });
});
