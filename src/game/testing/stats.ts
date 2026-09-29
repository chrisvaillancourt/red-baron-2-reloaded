/**
 * Soak statistics (FRICTION F-9): 95% intervals so a survey says how sure it is. A career survey
 * of ~80 missions has about ±9% on a 20% killed-or-captured rate, and 4 collisions could as well
 * have been 1 or 10. Compare two runs by their intervals, not their point values.
 */
const Z = 1.96;

/** Wilson score interval for k successes in n trials (proportions, 0..1). */
export function wilsonInterval(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (Z * Z) / n;
  const centre = (p + (Z * Z) / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Approximate 95% interval for a Poisson count k (score interval; good enough from k = 0). */
export function poissonInterval(k: number): [number, number] {
  const centre = k + (Z * Z) / 2;
  const half = Z * Math.sqrt(k + (Z * Z) / 4);
  return [Math.max(0, centre - half), centre + half];
}

export interface RateCounts {
  missions: number;
  killed: number;
  captured: number;
  /** Every collision event, whoever was involved (docs/ai.md "Wave 9 re-baseline"). */
  collisions: number;
  /** Collision events involving the player. */
  playerCollisions: number;
}

const f1 = (x: number) => x.toFixed(1);

/** One `key=value` line that tools/dev/ab.mjs parses; also readable by eye. */
export function ratesLine(c: RateCounts): string {
  const kc = c.killed + c.captured;
  const [lo, hi] = wilsonInterval(kc, c.missions);
  const [cLo, cHi] = poissonInterval(c.collisions);
  const per100 = (x: number) => (c.missions ? (100 * x) / c.missions : 0);
  return [
    'RATES',
    `missions=${c.missions}`,
    `killedCaptured=${kc}`,
    `kc%=${f1(per100(kc))}`,
    `kcLo=${f1(100 * lo)}`,
    `kcHi=${f1(100 * hi)}`,
    `coll=${c.collisions}`,
    `coll100=${f1(per100(c.collisions))}`,
    `collLo100=${f1(per100(cLo))}`,
    `collHi100=${f1(per100(cHi))}`,
    `playerColl=${c.playerCollisions}`,
  ].join(' ');
}
