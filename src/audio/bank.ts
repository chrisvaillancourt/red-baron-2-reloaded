/**
 * Lazily renders the synthesised buffers of ./synthBuffers.ts into
 * AudioBuffers for a given context, with a few variants per sound.
 */
import type { GunType } from '../core/types';
import {
  balloonWhoomph,
  crashCrunch,
  drumScrape,
  engineLoop,
  explosion,
  fireLoop,
  flakCrump,
  gunShot,
  hallImpulse,
  hammerClank,
  hitSound,
  jamClunk,
  latchClick,
  noiseLoop,
  uiSound,
  whizz,
  type EngineKind,
  type HitMaterial,
  type UiSound,
} from './synthBuffers';

export type SoundId =
  | `gun:${GunType}`
  | `hit:${HitMaterial}`
  | 'whizz'
  | 'flak'
  | 'explosion'
  | 'explosion-small'
  | 'whoomph'
  | 'crash'
  | 'jam'
  | 'hammer'
  | 'latch'
  | 'dryclick'
  | 'scrape'
  | `ui:${UiSound}`;

const VARIANTS: Partial<Record<string, number>> = {
  gun: 4,
  hit: 4,
  whizz: 3,
  flak: 3,
  hammer: 2,
  'ui:typewriter': 4,
};

export class SoundBank {
  private readonly cache = new Map<string, AudioBuffer[]>();
  private readonly loops = new Map<string, AudioBuffer>();

  constructor(private readonly ctx: BaseAudioContext) {}

  private toBuffer(data: Float32Array, channels: Float32Array[] = [data]): AudioBuffer {
    const b = this.ctx.createBuffer(channels.length, data.length, this.ctx.sampleRate);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  private render(id: SoundId, seed: number): Float32Array {
    const sr = this.ctx.sampleRate;
    const [kind, arg] = id.split(':') as [string, string | undefined];
    switch (kind) {
      case 'gun': return gunShot(arg as GunType, sr, seed);
      case 'hit': return hitSound(arg as HitMaterial, sr, seed);
      case 'whizz': return whizz(sr, seed);
      case 'flak': return flakCrump(sr, seed);
      case 'explosion': return explosion(sr, seed, 3);
      case 'explosion-small': return explosion(sr, seed + 50, 1.6);
      case 'whoomph': return balloonWhoomph(sr, seed);
      case 'crash': return crashCrunch(sr, seed);
      case 'jam': return jamClunk(sr, seed);
      case 'hammer': return hammerClank(sr, seed);
      case 'latch': return latchClick(sr, seed, 1);
      case 'dryclick': return latchClick(sr, seed + 7, 1.8);
      case 'scrape': return drumScrape(sr, seed);
      case 'ui': return uiSound(arg as UiSound, sr, seed);
    }
    throw new Error(`Unknown sound ${id}`);
  }

  /** A random variant of the sound. */
  get(id: SoundId): AudioBuffer {
    let list = this.cache.get(id);
    if (!list) {
      const n = VARIANTS[id] ?? VARIANTS[id.split(':')[0]] ?? 1;
      list = Array.from({ length: n }, (_, i) => this.toBuffer(this.render(id, i + 1)));
      this.cache.set(id, list);
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  /** Pre-render the sounds needed in flight so the first shot doesn't hitch. */
  warmFlight(): void {
    for (const g of ['vickers', 'spandau', 'lewis', 'parabellum'] as const) this.get(`gun:${g}`);
    for (const m of ['fabric', 'wood', 'metal'] as const) this.get(`hit:${m}`);
    this.get('flak');
    this.get('whizz');
    this.engine('rotary9');
    this.engine('inline6');
  }

  engine(kind: EngineKind): AudioBuffer {
    return this.loop(`engine:${kind}`, () => engineLoop(kind, this.ctx.sampleRate, 3));
  }

  noise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    return this.loop(`noise:${kind}`, () => noiseLoop(kind, this.ctx.sampleRate, 4));
  }

  fire(): AudioBuffer {
    return this.loop('fire', () => fireLoop(this.ctx.sampleRate));
  }

  hall(): AudioBuffer {
    const key = 'hall';
    let b = this.loops.get(key);
    if (!b) {
      const [l, r] = hallImpulse(this.ctx.sampleRate);
      b = this.toBuffer(l, [l, r]);
      this.loops.set(key, b);
    }
    return b;
  }

  private loop(key: string, make: () => Float32Array): AudioBuffer {
    let b = this.loops.get(key);
    if (!b) {
      b = this.toBuffer(make());
      this.loops.set(key, b);
    }
    return b;
  }
}
