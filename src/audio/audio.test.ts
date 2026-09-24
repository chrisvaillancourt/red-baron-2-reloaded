import { describe, expect, it } from 'vitest';
import { stats } from './dsp';
import { createAudioEngine, NullAudioEngine } from './index';
import { softClipCurve } from './limiter';
import { midiOf, midiToFreq, parseTrack, trackLength } from './music/notation';
import { SCORES } from './music/scores';
import { airAbsorptionCutoff, dopplerFactor, selectNearest, soundDelay } from './spatial';
import {
  balloonWhoomph,
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
