/**
 * Binds the HUD's controller menus (pause → Flight actions, map close) to one flight
 * session, and picks the contextual standard-controller hint. Kept out of FlightSession so
 * the ownership and staleness rules are testable without a renderer.
 */
import type { Hud } from '../ui/hud/types';
import { controllerFlightHint } from './flightPrompts';
import type { EdgeAction } from './input';

export interface FlightControllerDeps {
  hud: Pick<Hud, 'setControllerOptions'>;
  /** The flight input's pinned standard pad, or null. */
  owner(): Readonly<{ index: number; id: string }> | null;
  /** The session's edge-action dispatch (the path keyboard and touch edges take). */
  dispatch(action: EdgeAction): void;
  /** An error card above the flight, which then owns navigation. */
  foregroundOverlay(): HTMLElement | null;
  /** An open map holds the flight (touch-capable flights). */
  mapCapturesInput(): boolean;
}

/** Bumped by every bind: only the newest session's callbacks act. */
let epoch = 0;

/**
 * Hand the HUD this session's controller options. Returns the unbind, which clears the
 * HUD's options; afterwards, or once a newer session binds, every callback is a no-op.
 */
export function bindFlightController(deps: FlightControllerDeps): () => void {
  const mine = ++epoch;
  let bound = true;
  const live = () => bound && mine === epoch;
  deps.hud.setControllerOptions({
    gamepadAllowed: (pad) => {
      if (!live()) return false;
      const owner = deps.owner();
      return !!owner && pad.index === owner.index && pad.id === owner.id;
    },
    onAction: (action) => {
      if (live()) deps.dispatch(action);
    },
    foregroundOverlay: () => (live() ? deps.foregroundOverlay() : null),
    mapCapturesInput: () => live() && deps.mapCapturesInput(),
  });
  return () => {
    if (!bound) return;
    bound = false;
    deps.hud.setControllerOptions(null);
  };
}

/**
 * The contextual standard-controller hint: shown for the flight's first
 * `START_SECONDS` and for `CHANGE_SECONDS` after the pilot/gunner or bombsight context
 * changes (or a pad starts driving the flight). Times are flight seconds.
 */
export class ControllerHint {
  static readonly START_SECONDS = 20;
  static readonly CHANGE_SECONDS = 10;
  private context: string | null = null;
  private until = ControllerHint.START_SECONDS;

  update(time: number, padActive: boolean, atGun: boolean, bombsight: boolean): string | null {
    if (!padActive) {
      this.context = null;
      return null;
    }
    const context = `${atGun}:${bombsight}`;
    if (this.context !== null && this.context !== context) this.until = time + ControllerHint.CHANGE_SECONDS;
    else if (this.context === null && time >= this.until) this.until = time + ControllerHint.CHANGE_SECONDS;
    this.context = context;
    return time < this.until ? controllerFlightHint(atGun, bombsight) : null;
  }
}
