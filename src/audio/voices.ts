/**
 * Continuous voices: aircraft engines (with propeller wash) and generic
 * filtered noise loops (wind, wires, buffet, rumble, fire).
 */
import type { SoundBank } from './bank';
import { ENGINE_BASE_RPM, type EngineKind } from './synthBuffers';

const SMOOTH = 0.05; // s time constant for parameter changes

export interface EngineVoiceParams {
  rpm: number;
  throttle: number;
  /** Rotary blip switch held: ignition cut. */
  blip: boolean;
  /** 0..1 engine zone damage: misfires & roughness. */
  damage: number;
  dead: boolean;
  doppler: number;
  /** Low-pass cutoff (distance absorption / cockpit muffling), Hz. */
  cutoff: number;
  /** Overall level multiplier. */
  level: number;
}

export class EngineVoice {
  private readonly src: AudioBufferSourceNode;
  private readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly ignition: GainNode;
  private readonly level: GainNode;
  private readonly propSrc: AudioBufferSourceNode;
  private readonly propBand: BiquadFilterNode;
  private readonly propGain: GainNode;
  private readonly propLfo: OscillatorNode;
  private readonly propLfoDepth: GainNode;
  readonly output: GainNode;
  private misfireUntil = 0;
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    bank: SoundBank,
    readonly kind: EngineKind,
    dest: AudioNode,
  ) {
    const t = ctx.currentTime;
    this.src = ctx.createBufferSource();
    this.src.buffer = bank.engine(kind);
    this.src.loop = true;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = shaperCurve(kind === 'rotary9' ? 2.2 : 1.3);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.7;
    this.ignition = ctx.createGain();
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.output = ctx.createGain();

    // Propeller wash: noise band amplitude-modulated at blade-passing frequency.
    this.propSrc = ctx.createBufferSource();
    this.propSrc.buffer = bank.noise('pink');
    this.propSrc.loop = true;
    this.propBand = ctx.createBiquadFilter();
    this.propBand.type = 'bandpass';
    this.propBand.frequency.value = 700;
    this.propBand.Q.value = 0.6;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propLfo = ctx.createOscillator();
    this.propLfo.frequency.value = 40;
    this.propLfoDepth = ctx.createGain();
    this.propLfoDepth.gain.value = 0;
    this.propLfo.connect(this.propLfoDepth).connect(this.propGain.gain);

    this.src.connect(this.shaper).connect(this.tone).connect(this.ignition).connect(this.level).connect(this.output);
    this.propSrc.connect(this.propBand).connect(this.propGain).connect(this.output);
    this.output.connect(dest);
    const offset = Math.random() * 2;
    this.src.start(t, offset);
    this.propSrc.start(t, offset);
    this.propLfo.start(t);
  }

  update(p: EngineVoiceParams): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const running = !p.dead && p.rpm > 60;
    const rate = Math.max(0.05, p.rpm / ENGINE_BASE_RPM) * p.doppler;
    this.src.playbackRate.setTargetAtTime(rate, now, SMOOTH);

    // Load: louder and brighter under throttle.
    const load = 0.35 + 0.65 * p.throttle;
    const rpmNorm = Math.min(1.4, p.rpm / ENGINE_BASE_RPM);
    this.tone.frequency.setTargetAtTime(Math.min(p.cutoff, 900 + 4200 * load * rpmNorm), now, SMOOTH);

    let ign = running ? 1 : 0;
    if (running && p.blip) ign = 0.04;
    if (running && p.damage > 0.15) {
      // Random misfires, more frequent with damage.
      if (now > this.misfireUntil && Math.random() < p.damage * 0.06) {
        this.misfireUntil = now + 0.04 + Math.random() * 0.1 * p.damage;
      }
      if (now < this.misfireUntil) ign = 0.1;
    }
    this.ignition.gain.setTargetAtTime(ign, now, ign < 0.5 ? 0.008 : 0.02);
    this.level.gain.setTargetAtTime(p.level * load * Math.min(1, p.rpm / 400), now, SMOOTH);

    // Windmilling prop still makes wash even with the engine dead.
    const bladeHz = (2 * Math.max(0, p.rpm)) / 60;
    this.propLfo.frequency.setTargetAtTime(Math.max(1, bladeHz * p.doppler), now, SMOOTH);
    const wash = p.level * 0.18 * Math.min(1, p.rpm / 1400);
    this.propGain.gain.setTargetAtTime(wash * 0.6, now, SMOOTH);
    this.propLfoDepth.gain.setTargetAtTime(wash * 0.4, now, SMOOTH);
    this.propBand.frequency.setTargetAtTime(Math.min(p.cutoff, 500 + 500 * rpmNorm), now, SMOOTH);
  }

  /** Fade out and release nodes. */
  dispose(fade = 0.3): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(0, now, fade / 3);
    const stopAt = now + fade + 0.05;
    this.src.stop(stopAt);
    this.propSrc.stop(stopAt);
    this.propLfo.stop(stopAt);
    setTimeout(() => this.output.disconnect(), (fade + 0.2) * 1000);
  }
}

function shaperCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

/** A looping buffer through a filter and gain; used for wind, wires, buffet, rumble, fire. */
export class LoopVoice {
  private readonly src: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    buffer: AudioBuffer,
    dest: AudioNode,
    filterType: BiquadFilterType,
    freq: number,
    q = 0.7,
  ) {
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = filterType;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.filter).connect(this.gain).connect(dest);
    this.src.start(ctx.currentTime, Math.random() * buffer.duration);
  }

  set(level: number, freq?: number, rate?: number, tc = SMOOTH): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(Math.max(0, level), now, tc);
    if (freq !== undefined) this.filter.frequency.setTargetAtTime(freq, now, tc);
    if (rate !== undefined) this.src.playbackRate.setTargetAtTime(rate, now, tc);
  }

  dispose(fade = 0.3): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, now, fade / 3);
    this.src.stop(now + fade + 0.05);
    setTimeout(() => this.gain.disconnect(), (fade + 0.2) * 1000);
  }
}
