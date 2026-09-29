import { describe, expect, it } from 'vitest';
import { stats } from './dsp';
import { createAudioEngine, NullAudioEngine } from './index';
import { softClipCurve } from './limiter';
import { midiOf, midiToFreq, parseTrack, trackLength } from './music/notation';
import { SCORES } from './music/scores';
import { airAbsorptionCutoff, dopplerFactor, selectNearest, soundDelay } from './spatial';
import {
  balloonWhoomph,
  bombBurst,
  bombRelease,
  bombWhistle,
  BOMB_WHISTLE_SECONDS,
  crashCrunch,
  engineKindFor,
  engineLoop,
  ENGINE_BASE_RPM,
  ENGINE_PROFILES,
  explosion,
  fireLoop,
  flakCrump,
  gunShot,
  hallImpulse,
  hitSound,
  jamClunk,
  uiSound,
  whizz,
  type EngineKind,
} from './synthBuffers';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { ENGINE_DETUNE, engineParamsFor, type EngineVoiceParams } from './voices';

const SR = 22050;

function expectHealthy(buf: Float32Array, minRms = 0.005): void {
  const s = stats(buf);
  expect(s.nans).toBe(0);
  expect(s.peak).toBeLessThanOrEqual(1);
  expect(s.peak).toBeGreaterThan(0.1);
  expect(s.rms).toBeGreaterThan(minRms);
}

describe('synthesised buffers', () => {
  it('all one-shots are finite, non-silent and unclipped', () => {
    for (const g of ['vickers', 'spandau', 'lewis', 'parabellum'] as const) expectHealthy(gunShot(g, SR, 1));
    for (const m of ['fabric', 'wood', 'metal'] as const) expectHealthy(hitSound(m, SR, 2));
    for (const u of ['click', 'hover', 'confirm', 'back', 'typewriter', 'stamp'] as const) expectHealthy(uiSound(u, SR, 1), 0.001);
    expectHealthy(whizz(SR));
    expectHealthy(flakCrump(SR));
    expectHealthy(explosion(SR));
    expectHealthy(balloonWhoomph(SR));
    expectHealthy(crashCrunch(SR));
    expectHealthy(jamClunk(SR));
    expectHealthy(fireLoop(SR));
    const [l, r] = hallImpulse(SR, 1);
    expectHealthy(l);
    expectHealthy(r);
  });

  it('gun types sound different from each other', () => {
    const a = gunShot('vickers', SR, 1);
    const b = gunShot('lewis', SR, 1);
    expect(a.length).not.toBe(b.length);
  });

  it('is deterministic for a seed', () => {
    expect(gunShot('spandau', SR, 3)).toEqual(gunShot('spandau', SR, 3));
  });

  it('engine loops contain the right number of firing pulses per revolution', () => {
    for (const kind of Object.keys(ENGINE_PROFILES) as EngineKind[]) {
      const revs = 8;
      const buf = engineLoop(kind, SR, 1, revs);
      expectHealthy(buf, 0.05);
      expect(buf.length).toBe(Math.round(revs * (60 / ENGINE_BASE_RPM) * SR));
    }
  });

  it('rotary engines are rougher (more pulse-to-pulse variation) than inlines', () => {
    const roughness = (kind: EngineKind) => {
      const p = ENGINE_PROFILES[kind];
      const buf = engineLoop(kind, SR, 1, 24);
      const pulses = Math.round(24 * p.pulsesPerRev);
      const len = buf.length / pulses;
      const peaks: number[] = [];
      for (let k = 0; k < pulses; k++) {
        let m = 0;
        for (let i = Math.floor(k * len); i < Math.floor((k + 1) * len); i++) m = Math.max(m, Math.abs(buf[i]));
        peaks.push(m);
      }
      const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
      return Math.sqrt(peaks.reduce((a, b) => a + (b - mean) ** 2, 0) / peaks.length) / mean;
    };
    expect(roughness('rotary9')).toBeGreaterThan(roughness('inline6') * 1.5);
  });

  it('maps every aircraft to an engine sound', () => {
    for (const s of AIRCRAFT_LIST) {
      const k = engineKindFor(s.performance.engineType, s.performance.engineName);
      if (s.performance.engineType === 'rotary') expect(k).toBe('rotary9');
      else expect(k).not.toBe('rotary9');
    }
    expect(engineKindFor('inline', 'Hispano-Suiza 8Be')).toBe('v8');
    expect(engineKindFor('inline', 'Rolls-Royce Falcon III')).toBe('v12');
    expect(engineKindFor('inline', 'Mercedes D.IIIa')).toBe('inline6');
    expect(engineKindFor('inline', 'Renault 12Fcx')).toBe('v12');
  });
});

/** Zero crossings per second over a window, a stand-in for pitch. */
function crossingRate(buf: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (buf[i - 1] < 0 !== buf[i] < 0) n++;
  return (n * SR) / (to - from);
}

function rms(buf: Float32Array, from: number, to: number): number {
  let e = 0;
  for (let i = from; i < to; i++) e += buf[i] * buf[i];
  return Math.sqrt(e / (to - from));
}

describe('bomb sounds', () => {
  it('are finite, non-silent and unclipped', () => {
    expectHealthy(bombRelease(SR));
    expectHealthy(bombWhistle(SR));
    expectHealthy(bombBurst(SR));
    expect(bombWhistle(SR).length).toBe(Math.round(BOMB_WHISTLE_SECONDS * SR));
  });

  it('whistles down in pitch and swells towards the impact', () => {
    const w = bombWhistle(SR);
    const q = Math.floor(w.length / 5);
    expect(crossingRate(w, 4 * q - q, 4 * q)).toBeLessThan(crossingRate(w, q, 2 * q) * 0.85);
    expect(rms(w, 4 * q - q, 4 * q)).toBeGreaterThan(rms(w, q, 2 * q));
  });

  it('bursts with a concussion, then earth pattering back after it', () => {
    const b = bombBurst(SR, 1);
    const head = rms(b, 0, Math.round(0.3 * SR));
    // By 1-2 s the boom has decayed; the patter keeps the tail audible.
    const tail = rms(b, Math.round(1 * SR), Math.round(2 * SR));
    expect(head).toBeGreaterThan(tail * 3);
    expect(tail).toBeGreaterThan(0.004);
  });
});

describe('twin engines', () => {
  const base: EngineVoiceParams = { rpm: 1400, throttle: 1, blip: false, damage: 0.1, dead: false, doppler: 1, cutoff: 7500, level: 1 };

  it('detunes the second engine slightly and shares the loudness', () => {
    const a = engineParamsFor(base, 0, 2, undefined, 300);
    const b = engineParamsFor(base, 1, 2, undefined, 300);
    expect(b.rpm / a.rpm).toBeCloseTo(ENGINE_DETUNE[1], 6);
    expect(b.rpm / a.rpm - 1).toBeGreaterThan(0.005);
    expect(b.rpm / a.rpm - 1).toBeLessThan(0.03);
    expect(a.level).toBeLessThan(1);
    expect(a.level * Math.SQRT2).toBeGreaterThan(0.95);
    expect(a.damage).toBe(0.1);
  });

  it('kills one engine from its own damage and windmills its propeller', () => {
    const live = engineParamsFor(base, 0, 2, [0.4, 1], 300);
    const dead = engineParamsFor(base, 1, 2, [0.4, 1], 300);
    expect(live.dead).toBe(false);
    expect(live.damage).toBe(0.4);
    expect(dead.dead).toBe(true);
    expect(dead.rpm).toBeLessThanOrEqual(300 * ENGINE_DETUNE[1]);
  });
});

describe('music notation & scores', () => {
  it('parses pitches', () => {
    expect(midiOf('A4')).toBe(69);
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('Bb3')).toBe(58);
    expect(midiOf('F#2')).toBe(42);
    expect(midiToFreq(69)).toBeCloseTo(440);
  });

  it('parses chords, rests, rolls and velocity', () => {
    const n = parseTrack('C4+E4:2 R:1 X*4:1@0.5');
    expect(n).toHaveLength(5);
    expect(n[0].freqs).toHaveLength(2);
    expect(n[1].beat).toBe(3);
    expect(n[4].beat).toBeCloseTo(3.75);
    expect(n[4].velocity).toBeCloseTo(0.5);
    expect(n[1].velocity).toBeLessThan(n[4].velocity);
  });

  it('every score track has exactly the declared length', () => {
    for (const [cue, score] of Object.entries(SCORES)) {
      for (const t of score!.tracks) {
        expect(trackLength(t.notes), `${cue}/${t.instrument}`).toBeCloseTo(score!.lengthBeats, 6);
        expect(() => parseTrack(t.notes)).not.toThrow();
      }
    }
  });

  it('provides the cues the UI needs', () => {
    for (const cue of ['menu', 'briefing', 'defeat', 'victory', 'medal'] as const) expect(SCORES[cue]).toBeDefined();
    expect(SCORES.menu!.loop).toBe(true);
    expect(SCORES.victory!.loop).toBe(false);
  });
});

describe('spatial math', () => {
  const zero = { x: 0, y: 0, z: 0 };
  it('raises pitch for an approaching source and lowers it receding', () => {
    const approaching = dopplerFactor({ x: 0, y: 0, z: -500 }, { x: 0, y: 0, z: 60 }, zero, zero);
    const receding = dopplerFactor({ x: 0, y: 0, z: -500 }, { x: 0, y: 0, z: -60 }, zero, zero);
    expect(approaching).toBeCloseTo(343 / (343 - 60), 5);
    expect(receding).toBeCloseTo(343 / (343 + 60), 5);
    expect(dopplerFactor({ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 50 }, zero, zero)).toBeCloseTo(1, 5);
  });

  it('muffles distant sounds and delays them', () => {
    expect(airAbsorptionCutoff(10)).toBeGreaterThan(airAbsorptionCutoff(2000));
    expect(airAbsorptionCutoff(1e6)).toBeGreaterThanOrEqual(350);
    expect(soundDelay(343)).toBeCloseTo(1);
  });

  it('selects the nearest N sources within range, with hysteresis', () => {
    const src = [1, 2, 3, 4, 5].map((id) => ({ id, pos: { x: id * 100, y: 0, z: 0 } }));
    expect(selectNearest(src, zero, 2, 1000)).toEqual([1, 2]);
    expect(selectNearest(src, zero, 10, 250)).toEqual([1, 2]);
    // Source 3 is already voiced: 300 m × 0.6 = 180 m effective, so it keeps its voice over source 2.
    expect(selectNearest(src, zero, 2, 1000, new Set([3]), 0.6)).toEqual([1, 3]);
  });
});

describe('engine factory', () => {
  it('falls back to a silent engine without WebAudio', () => {
    const e = createAudioEngine();
    expect(e).toBeInstanceOf(NullAudioEngine);
    expect(() => e.playMusic('menu')).not.toThrow();
  });
});

describe('master limiter curve', () => {
  it('is monotonic, transparent below the knee and never reaches full scale', () => {
    const c = softClipCurve(1025);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(Math.max(...Array.from(c, Math.abs))).toBeLessThan(1);
    // Real input 0.5 sits (0.5 + 2) / 4 of the way along the ±2 domain.
    expect(c[Math.round(((0.5 + 2) / 4) * 1024)]).toBeCloseTo(0.5, 2);
  });
});
