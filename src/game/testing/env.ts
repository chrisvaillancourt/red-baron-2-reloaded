/** Environment knobs for the soak and replay runners. */

/** A positive integer from an env var, `fallback` when unset or empty; throws with the variable's name otherwise. */
export function positiveIntEnv(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const s = raw.trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  return n;
}
