// Same observable behavior as baseline, but no separate singleton import.
let ready = false;
let observations = 0;
export function initialized(): boolean { return ready; }
export function warmup(): void { ready = true; }
export function observe(): number {
  if (!ready) throw new Error('not warmed');
  return ++observations;
}
