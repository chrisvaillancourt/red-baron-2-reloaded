/**
 * Environment knobs for the soak and replay runners. Each reader returns `fallback` when
 * the variable is unset or empty and throws, naming the variable, on anything else it
 * can't read: a typo must fail the run, not silently fly zero repetitions.
 */

const trimmed = (raw: string | undefined): string | undefined => (raw === undefined || raw.trim() === '' ? undefined : raw.trim());

function intEnv(name: string, raw: string | undefined, fallback: number, min: number, what: string): number {
  const s = trimmed(raw);
  if (s === undefined) return fallback;
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < min) throw new Error(`${name} must be a ${what} integer, got ${JSON.stringify(raw)}.`);
  return n;
}

/** A positive integer (counts: reps, seeds, missions). */
export function positiveIntEnv(name: string, raw: string | undefined, fallback: number): number {
  return intEnv(name, raw, fallback, 1, 'positive');
}

/** A non-negative integer (seed bases, "0 = off" switches). */
export function nonNegativeIntEnv(name: string, raw: string | undefined, fallback: number): number {
  return intEnv(name, raw, fallback, 0, 'non-negative');
}

/** A finite decimal number, fractions and negatives allowed (times, angles, sigmas). */
export function finiteEnv(name: string, raw: string | undefined, fallback: number): number {
  const s = trimmed(raw);
  if (s === undefined) return fallback;
  const n = Number(s);
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s) || !Number.isFinite(n)) throw new Error(`${name} must be a finite number, got ${JSON.stringify(raw)}.`);
  return n;
}

/**
 * The entries of `table` named by the comma-separated `csv`, in CSV order, as the table's
 * own objects. Throws on an unknown name instead of dropping it, so a typo can't leave a
 * survey measuring nothing.
 */
export function selectSets<T>(name: string, csv: string, table: Record<string, T[]>): T[] {
  return csv.split(',').flatMap((key) => {
    if (!Object.hasOwn(table, key)) throw new Error(`${name} has unknown set ${JSON.stringify(key)}; use ${Object.keys(table).join(', ')}.`);
    return table[key];
  });
}
