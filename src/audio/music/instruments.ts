/**
 * Synthesised instrument voices for the score player. Each call schedules one
 * note on `ctx` into `dest` and lets the nodes stop/GC themselves.
 */
import type { InstrumentName } from './scores';

export interface InstrumentKit {
  noise: AudioBuffer;
}

function adsr(g: AudioParam, t: number, dur: number, peak: number, a: number, d: number, s: number, r: number): number {
  const end = t + Math.max(dur, a + d);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  g.setTargetAtTime(peak * s, t + a, d / 3);
  g.setValueAtTime(peak * s, end);
  g.setTargetAtTime(0, end, r / 3);
  return end + r * 1.5;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detuneCents = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detuneCents;
  return o;
}

function noiseSource(ctx: BaseAudioContext, kit: InstrumentKit, t: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = kit.noise;
  s.loop = true;
  s.loopStart = 0;
  s.loopEnd = kit.noise.duration;
  // Random offset so consecutive hits differ.
  s.start(t, Math.random() * (kit.noise.duration - 0.5));
  return s;
}

/** Schedule one note. `dur` in seconds, `vel` 0..1. */
export function playNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  kit: InstrumentKit,
  inst: InstrumentName,
  freqs: number[],
  t: number,
  dur: number,
  vel: number,
): void {
  switch (inst) {
    case 'brass':
    case 'horn': {
      const brassy = inst === 'brass';
      for (const f of freqs) {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = brassy ? 2 : 0.8;
        const base = brassy ? 700 : 450;
        const open = brassy ? 2600 * vel + 800 : 900 * vel + 400;
        lp.frequency.setValueAtTime(base, t);
        lp.frequency.linearRampToValueAtTime(base + open, t + 0.05);
        lp.frequency.setTargetAtTime(base + open * 0.55, t + 0.06, 0.15);
        const stop = adsr(g.gain, t, dur * 0.95, 0.22 * vel, brassy ? 0.035 : 0.06, 0.15, 0.75, 0.12);
        const vib = osc(ctx, 'sine', 5.3);
        const vibG = ctx.createGain();
        vibG.gain.setValueAtTime(0, t);
        vibG.gain.linearRampToValueAtTime(dur > 0.6 ? 7 : 0, t + Math.min(0.5, dur));
        vib.connect(vibG);
        const oscs = brassy
          ? [osc(ctx, 'sawtooth', f, -6), osc(ctx, 'sawtooth', f, 6), osc(ctx, 'square', f / 2, 0)]
          : [osc(ctx, 'triangle', f, -4), osc(ctx, 'sawtooth', f, 4)];
        for (const o of oscs) {
          vibG.connect(o.detune);
          o.connect(lp);
          o.start(t);
          o.stop(stop);
        }
        vib.start(t);
        vib.stop(stop);
        lp.connect(g).connect(dest);
      }
      return;
    }
    case 'strings':
    case 'lowstrings': {
      const low = inst === 'lowstrings';
      for (const f of freqs) {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = low ? 900 : 2000;
        const stop = low
          ? adsr(g.gain, t, dur * 0.7, 0.2 * vel, 0.01, 0.12, 0.5, 0.08)
          : adsr(g.gain, t, dur, 0.09 * vel, 0.35, 0.3, 0.85, 0.6);
        const detunes = low ? [-5, 5] : [-9, 0, 9];
        for (const d of detunes) {
          const o = osc(ctx, 'sawtooth', f, d);
          o.connect(lp);
          o.start(t);
          o.stop(stop);
        }
        lp.connect(g).connect(dest);
      }
      return;
    }
    case 'organ': {
      for (const f of freqs) {
        const g = ctx.createGain();
        const stop = adsr(g.gain, t, dur, 0.07 * vel, 0.02, 0.1, 0.9, 0.15);
        const drawbars: [number, number][] = [
          [0.5, 0.5],
          [1, 1],
          [2, 0.6],
          [3, 0.3],
          [4, 0.2],
        ];
        for (const [ratio, amp] of drawbars) {
          const o = osc(ctx, 'sine', f * ratio);
          const og = ctx.createGain();
          og.gain.value = amp;
          o.connect(og).connect(g);
          o.start(t);
          o.stop(stop);
        }
        g.connect(dest);
      }
      return;
    }
    case 'piano': {
      for (const f of freqs) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.004);
        g.gain.setTargetAtTime(0, t + 0.004, 0.5);
        g.gain.setTargetAtTime(0, t + dur, 0.08);
        const stop = t + Math.min(dur + 0.5, 3);
        const partials: [number, number][] = [
          [1, 1],
          [2.002, 0.45],
          [3.006, 0.22],
          [4.012, 0.1],
        ];
        for (const [ratio, amp] of partials) {
          const o = osc(ctx, 'sine', f * ratio);
          const og = ctx.createGain();
          og.gain.setValueAtTime(amp, t);
          og.gain.setTargetAtTime(amp * 0.2, t, 0.25 / ratio);
          o.connect(og).connect(g);
          o.start(t);
          o.stop(stop);
        }
        g.connect(dest);
      }
      return;
    }
    case 'tuba': {
      for (const f of freqs) {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(300, t);
        lp.frequency.linearRampToValueAtTime(500 + 500 * vel, t + 0.04);
        lp.frequency.setTargetAtTime(420, t + 0.05, 0.1);
        const stop = adsr(g.gain, t, dur * 0.7, 0.28 * vel, 0.025, 0.1, 0.6, 0.08);
        for (const o of [osc(ctx, 'sawtooth', f), osc(ctx, 'triangle', f, 3)]) {
          o.connect(lp);
          o.start(t);
          o.stop(stop);
        }
        lp.connect(g).connect(dest);
      }
      return;
    }
    case 'timpani': {
      for (const f of freqs) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.45 * vel, t);
        g.gain.setTargetAtTime(0, t, 0.35);
        const o = osc(ctx, 'sine', f * 1.05);
        o.frequency.setTargetAtTime(f, t, 0.03);
        const o2 = osc(ctx, 'sine', f * 1.5);
        const g2 = ctx.createGain();
        g2.gain.value = 0.3;
        o.connect(g);
        o2.connect(g2).connect(g);
        const n = noiseSource(ctx, kit, t);
        const nlp = ctx.createBiquadFilter();
        nlp.type = 'lowpass';
        nlp.frequency.value = 400;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.25 * vel, t);
        ng.gain.setTargetAtTime(0, t, 0.02);
        n.connect(nlp).connect(ng).connect(dest);
        const stop = t + 1.8;
        o.start(t);
        o2.start(t);
        o.stop(stop);
        o2.stop(stop);
        n.stop(t + 0.2);
        g.connect(dest);
      }
      return;
    }
    case 'snare': {
      const n = noiseSource(ctx, kit, t);
      const bp = ctx.createBiquadFilter();
      bp.type = 'highpass';
      bp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * vel, t);
      g.gain.setTargetAtTime(0, t, 0.045);
      n.connect(bp).connect(g).connect(dest);
      n.stop(t + 0.3);
      const o = osc(ctx, 'triangle', 190);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.35 * vel, t);
      og.gain.setTargetAtTime(0, t, 0.02);
      o.connect(og).connect(dest);
      o.start(t);
      o.stop(t + 0.15);
      return;
    }
    case 'kick': {
      const o = osc(ctx, 'sine', 110);
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8 * vel, t);
      g.gain.setTargetAtTime(0, t, 0.12);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 0.7);
      return;
    }
    case 'cymbal': {
      const n = noiseSource(ctx, kit, t);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35 * vel, t);
      g.gain.setTargetAtTime(0, t, 0.6);
      n.connect(hp).connect(g).connect(dest);
      n.stop(t + 3);
      return;
    }
  }
}
