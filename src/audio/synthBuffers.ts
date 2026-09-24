/**
 * Offline sound synthesis: every sample buffer the game uses is computed here
 * from scratch (DECISIONS: D-003 no sample files). Pure functions of
 * (sampleRate, seed) returning mono Float32Arrays, so they are testable in Node.
 */
import type { GunType } from '../core/types';
import {
  biquad,
  brownNoise,
  envelope,
  makeLoopable,
  mixInto,
  normalize,
  pinkNoise,
  removeDc,
  rng,
  whiteNoise,
} from './dsp';

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export type EngineKind = 'rotary9' | 'inline6' | 'v8' | 'v12';

/** RPM at which the pulse loop plays at playbackRate 1. */
export const ENGINE_BASE_RPM = 1200;

interface EngineProfile {
  /** Exhaust pulses per crankshaft revolution (cylinders / 2 for four-strokes). */
  pulsesPerRev: number;
  cylinders: number;
  /** Pulse decay time constant, s. */
  decay: number;
  /** Exhaust stack resonance, Hz (at base rpm). */
  ring: number;
  ringQ: number;
  /** 0..1 noise vs tone in each pulse. */
  noiseMix: number;
  /** Low body thump frequency, Hz. */
  thump: number;
  /** Random per-pulse amplitude variation. */
  ampVar: number;
  /** Fixed per-cylinder amplitude spread (lumpiness). */
  cylSpread: number;
  /** Timing jitter as a fraction of the pulse interval. */
  jitter: number;
  /** Continuous rasp (valve/cylinder clatter) mixed under the pulses. */
  rasp: number;
}

export const ENGINE_PROFILES: Record<EngineKind, EngineProfile> = {
  // Le Rhône / Clerget / Oberursel / Gnome: open exhaust ports spraying castor oil. Raw, lumpy, rasping.
  rotary9: { pulsesPerRev: 4.5, cylinders: 9, decay: 0.0045, ring: 520, ringQ: 3, noiseMix: 0.6, thump: 95, ampVar: 0.35, cylSpread: 0.3, jitter: 0.06, rasp: 0.35 },
  // Mercedes D.III / BMW / RAF 4a / Beardmore-type straight sixes: steady, deep throb.
  inline6: { pulsesPerRev: 3, cylinders: 6, decay: 0.011, ring: 190, ringQ: 2.2, noiseMix: 0.3, thump: 60, ampVar: 0.1, cylSpread: 0.08, jitter: 0.015, rasp: 0.08 },
  // Hispano-Suiza / Wolseley Viper V8: higher, buzzier drone.
  v8: { pulsesPerRev: 4, cylinders: 8, decay: 0.008, ring: 300, ringQ: 2.5, noiseMix: 0.35, thump: 75, ampVar: 0.12, cylSpread: 0.12, jitter: 0.02, rasp: 0.12 },
  // Rolls-Royce Falcon / Eagle V12: smooth, powerful roar.
  v12: { pulsesPerRev: 6, cylinders: 12, decay: 0.009, ring: 240, ringQ: 2, noiseMix: 0.35, thump: 65, ampVar: 0.07, cylSpread: 0.05, jitter: 0.012, rasp: 0.1 },
};

/** Map an aircraft's engine name/type to a synthesis profile. */
export function engineKindFor(engineType: string, engineName: string): EngineKind {
  if (engineType === 'rotary') return 'rotary9';
  const n = engineName.toLowerCase();
  if (n.includes('hispano') || n.includes('viper')) return 'v8';
  if (n.includes('falcon') || n.includes('eagle')) return 'v12';
  return 'inline6';
}

/**
 * A seamless loop of exhaust pulses covering `revs` crank revolutions at
 * ENGINE_BASE_RPM. Played with playbackRate = rpm / ENGINE_BASE_RPM, pulse
 * rate tracks rpm. Pulse tails wrap around so the loop has no seam.
 */
export function engineLoop(kind: EngineKind, sampleRate: number, seed = 1, revs = 48): Float32Array {
  const p = ENGINE_PROFILES[kind];
  const rand = rng(seed);
  const revSamples = (60 / ENGINE_BASE_RPM) * sampleRate;
  const total = Math.round(revs * revSamples);
  const out = new Float32Array(total);
  const pulses = Math.round(revs * p.pulsesPerRev);
  const interval = total / pulses;
  const cylBias = Array.from({ length: p.cylinders }, () => 1 - p.cylSpread * rand());
  const pulseLen = Math.ceil(Math.max(p.decay * 7, 3 / p.thump) * sampleRate);
  const pulse = new Float32Array(pulseLen);
  for (let k = 0; k < pulses; k++) {
    const amp = cylBias[k % p.cylinders] * (1 - p.ampVar * rand());
    const ring = p.ring * (0.92 + 0.16 * rand());
    for (let i = 0; i < pulseLen; i++) {
      const t = i / sampleRate;
      const e = Math.exp(-t / p.decay);
      const tone = Math.sin(2 * Math.PI * ring * t);
      const noise = rand() * 2 - 1;
      const body = Math.exp(-t / (p.decay * 3.5)) * Math.sin(2 * Math.PI * p.thump * t);
      pulse[i] = amp * (e * (p.noiseMix * noise + (1 - p.noiseMix) * tone) + 0.9 * body);
    }
    const at = Math.round(k * interval + (rand() - 0.5) * p.jitter * interval);
    mixInto(out, pulse, at, 1, true);
  }
  if (p.rasp > 0) {
    // Mechanical clatter: bright noise gated by the firing rhythm.
    const rasp = biquad(whiteNoise(total, rand), 'bandpass', 2600, 0.9, sampleRate);
    for (let i = 0; i < total; i++) {
      const phase = (i % interval) / interval;
      out[i] += rasp[i] * p.rasp * (0.4 + 0.6 * Math.exp(-phase * 6));
    }
  }
  removeDc(out);
  return normalize(out, 0.9);
}

// ---------------------------------------------------------------------------
// Guns
// ---------------------------------------------------------------------------

interface GunProfile {
  crackFreq: number;
  crackQ: number;
  crackDecay: number;
  bodyFrom: number;
  bodyTo: number;
  bodyDecay: number;
  bodyGain: number;
  clickFreq: number;
  clickDelay: number;
  clickGain: number;
  /** Resonant ring (Lewis cooling shroud), Hz; 0 = none. */
  ring: number;
  ringDecay: number;
  length: number;
}

const GUN_PROFILES: Record<GunType, GunProfile> = {
  // Water-jacketed Vickers: heavy, muffled "thud".
  vickers: { crackFreq: 1200, crackQ: 1.1, crackDecay: 0.022, bodyFrom: 150, bodyTo: 55, bodyDecay: 0.06, bodyGain: 1.0, clickFreq: 3400, clickDelay: 0.022, clickGain: 0.25, ring: 0, ringDecay: 0, length: 0.2 },
  // LMG 08/15: sharper, a touch higher than the Vickers.
  spandau: { crackFreq: 1750, crackQ: 1.2, crackDecay: 0.018, bodyFrom: 175, bodyTo: 62, bodyDecay: 0.05, bodyGain: 0.9, clickFreq: 4200, clickDelay: 0.016, clickGain: 0.3, ring: 0, ringDecay: 0, length: 0.18 },
  // Air-cooled Lewis: lighter bark with a ringing aluminium shroud.
  lewis: { crackFreq: 2400, crackQ: 1.3, crackDecay: 0.014, bodyFrom: 210, bodyTo: 85, bodyDecay: 0.035, bodyGain: 0.7, clickFreq: 5000, clickDelay: 0.012, clickGain: 0.3, ring: 880, ringDecay: 0.04, length: 0.16 },
  // Parabellum: fast, bright rattle.
  parabellum: { crackFreq: 2800, crackQ: 1.4, crackDecay: 0.012, bodyFrom: 230, bodyTo: 95, bodyDecay: 0.03, bodyGain: 0.65, clickFreq: 5300, clickDelay: 0.01, clickGain: 0.35, ring: 0, ringDecay: 0, length: 0.14 },
};

export function gunShot(type: GunType, sampleRate: number, seed = 1): Float32Array {
  const p = GUN_PROFILES[type];
  const rand = rng(seed * 7919 + type.length);
  const n = Math.round(p.length * sampleRate);
  const crack = biquad(whiteNoise(n, rand), 'bandpass', p.crackFreq * (0.95 + 0.1 * rand()), p.crackQ, sampleRate);
  envelope(crack, sampleRate, 0.0004, p.crackDecay);
  const out = new Float32Array(n);
  mixInto(out, crack, 0, 2.2);
  // Pitched body sweep (muzzle blast pressure wave).
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = p.bodyTo + (p.bodyFrom - p.bodyTo) * Math.exp(-t / 0.015);
    phase += (2 * Math.PI * f) / sampleRate;
    out[i] += p.bodyGain * Math.exp(-t / p.bodyDecay) * Math.sin(phase);
    if (p.ring > 0) out[i] += 0.18 * Math.exp(-t / p.ringDecay) * Math.sin(2 * Math.PI * p.ring * t);
  }
  // Mechanism: bolt/lock click shortly after the shot.
  const clickLen = Math.round(0.006 * sampleRate);
  const click = biquad(whiteNoise(clickLen, rand), 'bandpass', p.clickFreq, 2, sampleRate);
  envelope(click, sampleRate, 0.0002, 0.0012);
  mixInto(out, click, Math.round(p.clickDelay * sampleRate), p.clickGain * 3);
  removeDc(out);
  return normalize(out, 0.9);
}

// ---------------------------------------------------------------------------
// Impacts on own aircraft
// ---------------------------------------------------------------------------

export type HitMaterial = 'fabric' | 'wood' | 'metal';

export function hitSound(material: HitMaterial, sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 104729 + material.length);
  if (material === 'fabric') {
    // Doped linen tearing: a few rapid micro-bursts.
    const n = Math.round(0.14 * sampleRate);
    const out = new Float32Array(n);
    const bursts = 3 + Math.floor(rand() * 3);
    for (let b = 0; b < bursts; b++) {
      const len = Math.round((0.01 + 0.015 * rand()) * sampleRate);
      const burst = biquad(whiteNoise(len, rand), 'bandpass', 1800 + 1800 * rand(), 0.8, sampleRate);
      envelope(burst, sampleRate, 0.001, 0.006);
      mixInto(out, burst, Math.round((b * 0.018 + 0.006 * rand()) * sampleRate), 1 - b * 0.15);
    }
    // Initial pop of the bullet punching through.
    const pop = biquad(whiteNoise(Math.round(0.004 * sampleRate), rand), 'highpass', 3000, 0.7, sampleRate);
    mixInto(out, pop, 0, 1.2);
    return normalize(removeDc(out), 0.85);
  }
  if (material === 'wood') {
    // Spruce splintering: sharp click + resonant crack + a second splinter.
    const n = Math.round(0.12 * sampleRate);
    const out = new Float32Array(n);
    for (let s = 0; s < 2; s++) {
      const len = Math.round(0.05 * sampleRate);
      const crack = biquad(whiteNoise(len, rand), 'bandpass', 380 + 420 * rand(), 6, sampleRate);
      envelope(crack, sampleRate, 0.0003, 0.012);
      const click = biquad(whiteNoise(Math.round(0.003 * sampleRate), rand), 'highpass', 2500, 0.7, sampleRate);
      const at = Math.round(s * (0.02 + 0.02 * rand()) * sampleRate);
      mixInto(out, crack, at, s === 0 ? 3 : 1.6);
      mixInto(out, click, at, s === 0 ? 1 : 0.5);
    }
    return normalize(removeDc(out), 0.85);
  }
  // Metal: engine cowling / gun breech ping, inharmonic partials.
  const n = Math.round(0.35 * sampleRate);
  const out = new Float32Array(n);
  const f0 = 1700 + 900 * rand();
  const partials: [number, number, number][] = [
    [1, 1, 0.09],
    [2.76, 0.6, 0.05],
    [5.4, 0.35, 0.03],
    [8.93, 0.2, 0.02],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const [r, a, d] of partials) v += a * Math.exp(-t / d) * Math.sin(2 * Math.PI * f0 * r * t);
    out[i] = v;
  }
  const click = biquad(whiteNoise(Math.round(0.004 * sampleRate), rand), 'highpass', 4000, 0.7, sampleRate);
  mixInto(out, click, 0, 1.5);
  return normalize(removeDc(out), 0.8);
}

/** Near-miss: bullet crack + short whizz sweeping down in pitch. */
export function whizz(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 31337);
  const n = Math.round(0.22 * sampleRate);
  const noise = whiteNoise(n, rand);
  const out = new Float32Array(n);
  // Time-varying bandpass approximated by processing in short blocks.
  const block = 256;
  for (let s = 0; s < n; s += block) {
    const t = s / n;
    const seg = noise.slice(s, Math.min(n, s + block));
    biquad(seg, 'bandpass', 5200 - 3800 * t, 5, sampleRate);
    const env = Math.sin(Math.PI * Math.min(1, t * 1.3)) ** 2;
    for (let i = 0; i < seg.length; i++) out[s + i] = seg[i] * env;
  }
  const crack = biquad(whiteNoise(Math.round(0.003 * sampleRate), rand), 'highpass', 3000, 0.7, sampleRate);
  mixInto(out, crack, Math.round(0.02 * sampleRate), 0.4);
  return normalize(out, 0.7);
}

// ---------------------------------------------------------------------------
// Big bangs
// ---------------------------------------------------------------------------

/** Anti-aircraft shell burst ("archie"): a hollow crump with a crackling tail. */
export function flakCrump(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 6007);
  const n = Math.round(1.8 * sampleRate);
  const boom = biquad(whiteNoise(n, rand), 'lowpass', 260, 0.9, sampleRate);
  envelope(boom, sampleRate, 0.004, 0.35);
  const out = new Float32Array(n);
  mixInto(out, boom, 0, 3);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = 32 + 45 * Math.exp(-t / 0.08);
    phase += (2 * Math.PI * f) / sampleRate;
    out[i] += 0.9 * Math.exp(-t / 0.25) * Math.sin(phase);
  }
  // Shrapnel crackle.
  const clickLen = Math.round(0.002 * sampleRate);
  for (let c = 0; c < 40; c++) {
    const t = 0.05 + Math.pow(rand(), 1.8) * 1.3;
    const click = biquad(whiteNoise(clickLen, rand), 'bandpass', 1500 + 2500 * rand(), 1.2, sampleRate);
    mixInto(out, click, Math.round(t * sampleRate), 0.5 * Math.exp(-t / 0.6) * rand());
  }
  return normalize(removeDc(out), 0.9);
}

export function explosion(sampleRate: number, seed = 1, seconds = 3): Float32Array {
  const rand = rng(seed * 4099);
  const n = Math.round(seconds * sampleRate);
  const boom = biquad(brownNoise(n, rand), 'lowpass', 420, 0.8, sampleRate);
  envelope(boom, sampleRate, 0.006, seconds * 0.3);
  const crack = biquad(whiteNoise(n, rand), 'lowpass', 2500, 0.7, sampleRate);
  envelope(crack, sampleRate, 0.001, 0.08);
  const out = new Float32Array(n);
  mixInto(out, boom, 0, 4);
  mixInto(out, crack, 0, 1.2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * (28 + 50 * Math.exp(-t / 0.12))) / sampleRate;
    out[i] += 1.1 * Math.exp(-t / 0.5) * Math.sin(phase);
  }
  return normalize(removeDc(out), 0.95);
}

/** Hydrogen balloon igniting: a rising "whoomph" into a roar. */
export function balloonWhoomph(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 2027);
  const n = Math.round(4 * sampleRate);
  const noise = pinkNoise(n, rand);
  const out = new Float32Array(n);
  const block = 512;
  for (let s = 0; s < n; s += block) {
    const t = s / sampleRate;
    const seg = noise.slice(s, Math.min(n, s + block));
    biquad(seg, 'lowpass', 250 + 700 * Math.min(1, t / 0.8) * Math.exp(-Math.max(0, t - 1.2) / 1.5), 0.8, sampleRate);
    const env = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.6) / 1.2);
    for (let i = 0; i < seg.length; i++) out[s + i] = seg[i] * env;
  }
  return normalize(removeDc(out), 0.9);
}

/** Aircraft hitting the ground: crunching wood, tearing fabric, metal. */
export function crashCrunch(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 8191);
  const n = Math.round(1.6 * sampleRate);
  const out = new Float32Array(n);
  const thud = biquad(brownNoise(n, rand), 'lowpass', 300, 0.9, sampleRate);
  envelope(thud, sampleRate, 0.003, 0.25);
  mixInto(out, thud, 0, 5);
  for (let k = 0; k < 10; k++) {
    const mat: HitMaterial = k % 3 === 0 ? 'metal' : k % 3 === 1 ? 'wood' : 'fabric';
    const s = hitSound(mat, sampleRate, seed * 13 + k);
    const t = Math.pow(rand(), 1.5) * 0.9;
    mixInto(out, s, Math.round(t * sampleRate), (mat === 'metal' ? 0.25 : 0.6) * (1 - t * 0.6));
  }
  return normalize(removeDc(out), 0.95);
}

// ---------------------------------------------------------------------------
// Gun handling
// ---------------------------------------------------------------------------

/** Jammed round: a dead mechanical clunk. */
export function jamClunk(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 997);
  const n = Math.round(0.22 * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * 170 * t) + 0.3 * Math.exp(-t / 0.02) * Math.sin(2 * Math.PI * 610 * t);
  }
  const click = biquad(whiteNoise(Math.round(0.008 * sampleRate), rand), 'bandpass', 2500, 1.5, sampleRate);
  mixInto(out, click, 0, 1.2);
  return normalize(removeDc(out), 0.8);
}

/** Hammering the cocking handle of a jammed gun. */
export function hammerClank(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 353);
  const n = Math.round(0.28 * sampleRate);
  const out = new Float32Array(n);
  const f0 = 760 + 120 * rand();
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] =
      0.7 * Math.exp(-t / 0.05) * Math.sin(2 * Math.PI * f0 * t) +
      0.4 * Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * f0 * 2.43 * t) +
      0.8 * Math.exp(-t / 0.015) * Math.sin(2 * Math.PI * 140 * t);
  }
  const click = biquad(whiteNoise(Math.round(0.004 * sampleRate), rand), 'highpass', 3000, 0.7, sampleRate);
  mixInto(out, click, 0, 1.4);
  return normalize(removeDc(out), 0.85);
}

/** Short latch/lever click (drum latch, cocking, dry fire). */
export function latchClick(sampleRate: number, seed = 1, bright = 1): Float32Array {
  const rand = rng(seed * 211);
  const n = Math.round(0.05 * sampleRate);
  const out = biquad(whiteNoise(n, rand), 'bandpass', 2200 * bright + 800 * rand(), 3, sampleRate);
  envelope(out, sampleRate, 0.0002, 0.004);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] += 0.4 * Math.exp(-t / 0.01) * Math.sin(2 * Math.PI * 900 * bright * t);
  }
  return normalize(removeDc(out), 0.7);
}

/** Drum pan sliding off/on the Lewis post. */
export function drumScrape(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 1231);
  const n = Math.round(0.4 * sampleRate);
  const noise = whiteNoise(n, rand);
  const out = new Float32Array(n);
  const block = 256;
  for (let s = 0; s < n; s += block) {
    const t = s / n;
    const seg = noise.slice(s, Math.min(n, s + block));
    biquad(seg, 'bandpass', 1400 + 1600 * t, 4, sampleRate);
    const env = Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(t * 70));
    for (let i = 0; i < seg.length; i++) out[s + i] = seg[i] * env;
  }
  return normalize(out, 0.6);
}

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

export function noiseLoop(kind: 'white' | 'pink' | 'brown', sampleRate: number, seconds = 4, seed = 1): Float32Array {
  const rand = rng(seed * 17);
  const n = Math.round(seconds * sampleRate);
  const raw = kind === 'white' ? whiteNoise(n, rand) : kind === 'pink' ? pinkNoise(n, rand) : brownNoise(n, rand);
  return normalize(makeLoopable(raw, Math.round(0.05 * sampleRate)), 0.8);
}

/** Burning doped fabric & wood: crackles over a low roar. Seamless loop. */
export function fireLoop(sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 577);
  const n = Math.round(3 * sampleRate);
  const roar = biquad(pinkNoise(n, rand), 'lowpass', 500, 0.7, sampleRate);
  const out = new Float32Array(n);
  mixInto(out, roar, 0, 0.8);
  const clickLen = Math.round(0.003 * sampleRate);
  for (let c = 0; c < 140; c++) {
    const click = biquad(whiteNoise(clickLen, rand), 'bandpass', 1000 + 4000 * rand(), 1.5, sampleRate);
    mixInto(out, click, Math.floor(rand() * n), Math.pow(rand(), 2) * 3, true);
  }
  return normalize(removeDc(out), 0.8);
}

// ---------------------------------------------------------------------------
// Interface sounds
// ---------------------------------------------------------------------------

export type UiSound = 'click' | 'hover' | 'confirm' | 'back' | 'typewriter' | 'stamp';

export function uiSound(kind: UiSound, sampleRate: number, seed = 1): Float32Array {
  const rand = rng(seed * 503 + kind.length);
  const tone = (n: number, parts: [number, number, number, number][]) => {
    // parts: [freq, amp, decay, startTime]
    const out = new Float32Array(n);
    for (const [f, a, d, st] of parts) {
      const s0 = Math.round(st * sampleRate);
      for (let i = s0; i < n; i++) {
        const t = (i - s0) / sampleRate;
        out[i] += a * Math.min(1, t / 0.003) * Math.exp(-t / d) * Math.sin(2 * Math.PI * f * t);
      }
    }
    return out;
  };
  switch (kind) {
    case 'click': {
      const out = tone(Math.round(0.05 * sampleRate), [[1900, 0.6, 0.012, 0], [3800, 0.2, 0.006, 0]]);
      const c = biquad(whiteNoise(Math.round(0.003 * sampleRate), rand), 'highpass', 2500, 0.7, sampleRate);
      mixInto(out, c, 0, 0.6);
      return normalize(out, 0.5);
    }
    case 'hover':
      return normalize(tone(Math.round(0.03 * sampleRate), [[3100, 0.4, 0.006, 0]]), 0.25);
    case 'confirm':
      return normalize(
        tone(Math.round(0.45 * sampleRate), [[660, 0.6, 0.12, 0], [1320, 0.2, 0.06, 0], [990, 0.6, 0.18, 0.09], [1980, 0.2, 0.08, 0.09]]),
        0.5,
      );
    case 'back':
      return normalize(tone(Math.round(0.35 * sampleRate), [[700, 0.6, 0.08, 0], [470, 0.6, 0.12, 0.07]]), 0.45);
    case 'typewriter': {
      const n = Math.round(0.08 * sampleRate);
      const out = biquad(whiteNoise(n, rand), 'highpass', 1400 + 800 * rand(), 0.8, sampleRate);
      envelope(out, sampleRate, 0.0003, 0.006);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        out[i] += 0.6 * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * (380 + 60 * rand()) * t);
      }
      const back = biquad(whiteNoise(Math.round(0.01 * sampleRate), rand), 'bandpass', 2600, 2, sampleRate);
      envelope(back, sampleRate, 0.0003, 0.003);
      mixInto(out, back, Math.round(0.035 * sampleRate), 0.4);
      return normalize(removeDc(out), 0.55);
    }
    case 'stamp': {
      const n = Math.round(0.3 * sampleRate);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        out[i] = Math.exp(-t / 0.05) * Math.sin(2 * Math.PI * (70 + 60 * Math.exp(-t / 0.01)) * t);
      }
      const slap = biquad(whiteNoise(Math.round(0.06 * sampleRate), rand), 'bandpass', 1200, 0.8, sampleRate);
      envelope(slap, sampleRate, 0.0005, 0.015);
      mixInto(out, slap, 0, 1.4);
      return normalize(removeDc(out), 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Reverb
// ---------------------------------------------------------------------------

/** Stereo impulse response for a mid-sized hall (music) as [left, right]. */
export function hallImpulse(sampleRate: number, seconds = 2.4, seed = 1): [Float32Array, Float32Array] {
  const make = (s: number) => {
    const rand = rng(s);
    const n = Math.round(seconds * sampleRate);
    const b = whiteNoise(n, rand);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      b[i] *= Math.exp(-t / (seconds * 0.22)) * Math.min(1, t / 0.01);
    }
    biquad(b, 'lowpass', 5500, 0.7, sampleRate);
    return normalize(b, 0.5);
  };
  return [make(seed), make(seed + 99)];
}
