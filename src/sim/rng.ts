/** Small seedable PRNG (mulberry32) so combat/flight randomness is reproducible in tests. */
export type Rng = () => number;

export function createRng(seed = 0x9e3779b9): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately normal(0,1) from a uniform rng (Irwin-Hall, 4 samples). */
export function gaussian(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508;
}
