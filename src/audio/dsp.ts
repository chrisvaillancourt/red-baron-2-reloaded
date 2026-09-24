/**
 * Pure DSP helpers used to pre-render one-shot buffers (guns, hits, flak,
 * engine pulse loops). No WebAudio dependency, so they are unit-testable in Node.
 */

/** Deterministic PRNG (mulberry32). Returns a function yielding [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';

/** In-place RBJ-cookbook biquad. */
export function biquad(buf: Float32Array, type: BiquadType, freq: number, q: number, sampleRate: number, gainDb = 0): Float32Array {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking': {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    }
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

export function whiteNoise(n: number, rand: () => number): Float32Array {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = rand() * 2 - 1;
  return b;
}

/** Paul Kellet's economy pink noise. */
export function pinkNoise(n: number, rand: () => number): Float32Array {
  const b = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    b[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return b;
}

export function brownNoise(n: number, rand: () => number): Float32Array {
  const b = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    b[i] = last * 3.5;
  }
  return b;
}

/** Cross-fade the loop seam so a buffer loops without a click. */
export function makeLoopable(buf: Float32Array, fadeSamples: number): Float32Array {
  const n = buf.length;
  const f = Math.min(fadeSamples, Math.floor(n / 4));
  const out = buf.slice(0, n - f);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = buf[i] * t + buf[n - f + i] * (1 - t);
  }
  return out;
}

export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** One-pole DC blocker, in place. */
export function removeDc(buf: Float32Array): Float32Array {
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = x - x1 + 0.995 * y1;
    x1 = x; y1 = y;
    buf[i] = y;
  }
  return buf;
}

/** Mix `src` into `dst` at `offset` (samples), scaled by `gain`. Wraps around if `wrap`. */
export function mixInto(dst: Float32Array, src: Float32Array, offset: number, gain = 1, wrap = false): void {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    let j = offset + i;
    if (wrap) j = ((j % n) + n) % n;
    else if (j < 0 || j >= n) continue;
    dst[j] += src[i] * gain;
  }
}

/** Quick attack / exponential decay envelope applied in place. */
export function envelope(buf: Float32Array, sampleRate: number, attack: number, decay: number): Float32Array {
  const a = Math.max(1, attack * sampleRate);
  const d = decay * sampleRate;
  for (let i = 0; i < buf.length; i++) {
    const env = i < a ? i / a : Math.exp(-(i - a) / d);
    buf[i] *= env;
  }
  return buf;
}

export interface BufferStats {
  peak: number;
  rms: number;
  nans: number;
}

export function stats(buf: Float32Array): BufferStats {
  let peak = 0, sum = 0, nans = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { nans++; continue; }
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, buf.length)), nans };
}
