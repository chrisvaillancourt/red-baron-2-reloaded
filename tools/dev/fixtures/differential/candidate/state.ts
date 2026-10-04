let ready = false;
let observations = 0;
export function initialized(): boolean { return ready; }
export function warmup(): void { ready = true; }
export function observe(): number {
  if (!ready) throw new Error('not warmed');
  return 10 + ++observations;
}
export const signedZero: number = 0;
export const notANumber = null;
