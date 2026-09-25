/**
 * Registry of the flight in progress (one at a time). Kept apart from
 * flightSession.ts so the menu bundle can abort a flight during error
 * recovery without statically importing the flight chunk.
 */

export interface AbortableFlight {
  abort(err: unknown, silent: boolean): void;
}

let active: AbortableFlight | null = null;

export function setActiveFlight(f: AbortableFlight | null): void {
  active = f;
}

export function getActiveFlight(): AbortableFlight | null {
  return active;
}

/**
 * Stop the flight in progress with an error, if there is one: the session tears
 * down and its fly() promise rejects (the UI goes back to where it was and
 * records nothing). `silent` skips the "flight interrupted" card, e.g. when the
 * app is recovering from an error it is already reporting.
 */
export function abortActiveFlight(err: unknown, opts: { silent?: boolean } = {}): boolean {
  if (!active) return false;
  active.abort(err, opts.silent ?? false);
  return true;
}
