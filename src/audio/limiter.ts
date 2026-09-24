/**
 * Master-bus limiter: a fast compressor followed by a soft clipper, so
 * overlapping explosions can never exceed full scale (the compressor alone
 * lets attack transients through).
 */
export interface Limiter {
  input: AudioNode;
  output: AudioNode;
}

export function createLimiter(ctx: BaseAudioContext): Limiter {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 4;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  // WaveShaper curves span input ±1; halve first so the curve covers ±2 of real signal.
  const pre = ctx.createGain();
  pre.gain.value = 0.5;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = '2x';
  comp.connect(pre).connect(clip);
  return { input: comp, output: clip };
}

/** Linear to ±0.8, then a tanh knee asymptotic to ±0.99. */
export function softClipCurve(n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const knee = 0.8;
  const head = 0.99 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2; // real input range ±2 (after the 0.5 pre-gain)
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + head * Math.tanh((a - knee) / head);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
