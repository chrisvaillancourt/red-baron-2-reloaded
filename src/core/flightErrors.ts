/**
 * Errors a flight session has already explained to the player with its own
 * error card. FlightLauncher.fly() still rejects with them, and callers use
 * wasErrorReported() so they don't report the same failure twice.
 */
const reported = new WeakSet<object>();

/** Returns the error as an object (non-objects are wrapped) and marks it reported. */
export function markErrorReported(err: unknown): Error | object {
  const e = typeof err === 'object' && err !== null ? err : new Error(String(err));
  reported.add(e);
  return e;
}

export function wasErrorReported(err: unknown): boolean {
  return typeof err === 'object' && err !== null && reported.has(err);
}
