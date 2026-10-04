/** Menu-bundle registry: abort a battery session without loading its renderer. */
export interface ActiveDefense {
  abort(error: unknown): void;
}
let active: ActiveDefense | null = null;
export function getActiveDefense(): ActiveDefense | null {
  return active;
}
export function setActiveDefense(session: ActiveDefense | null): void {
  active = session;
}
export function abortActiveDefense(error: unknown = new Error('Defense interrupted')): boolean {
  if (!active) return false;
  active.abort(error);
  return true;
}
