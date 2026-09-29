/**
 * Falling-bomb whistles (docs/audio.md "Bombs"): when each starts, and how many play.
 * Pure (Node-testable); the audio engine plays what `due` returns.
 */
import { BOMB_WHISTLE_SECONDS } from './synthBuffers';

/** Whistles playing at once; more due at the same time are dropped, farthest first. */
export const MAX_WHISTLES = 3;
/** A whistle is handed out this long before its start (the engine's frame granularity). */
const LOOKAHEAD = 0.1;
/** A whistle not played within this of its start would end late: dropped. */
const STALE = 0.25;

/**
 * Start time for a whistle ending at the impact, `impactIn` s after `now`, played at `rate`
 * (the clip lasts BOMB_WHISTLE_SECONDS / rate). Both ends are in source time: the engine
 * applies the same sound-travel delay to the whistle as to the burst, so it ends at the heard
 * burst. Null when the fall is too short for most of the whistle.
 */
export function whistleStart(now: number, impactIn: number, rate: number): number | null {
  const len = BOMB_WHISTLE_SECONDS / rate;
  if (impactIn < len * 0.6) return null;
  return now + Math.max(0, impactIn - len);
}

export interface PendingWhistle {
  /** Source start time (engine clock), from `whistleStart`. */
  start: number;
  rate: number;
  /** Distance from the listener to the impact, m: nearer whistles win a slot. */
  distance: number;
}

/**
 * Whistles waiting for their start. They don't hold a one-shot voice while they wait (a
 * bomb can fall for 20 s), and at most MAX_WHISTLES play at once, nearest first.
 */
export class WhistleQueue<T extends PendingWhistle = PendingWhistle> {
  private readonly waiting: T[] = [];
  private readonly playingUntil: number[] = [];

  get pending(): number {
    return this.waiting.length;
  }

  add(w: T): void {
    this.waiting.push(w);
  }

  /** The whistles to start now (each at its own `start`, at most LOOKAHEAD s ahead). */
  due(now: number): T[] {
    for (let i = this.playingUntil.length - 1; i >= 0; i--) if (this.playingUntil[i] <= now) this.playingUntil.splice(i, 1);
    if (!this.waiting.length) return [];
    const ready: T[] = [];
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      if (w.start > now + LOOKAHEAD) continue;
      this.waiting.splice(i, 1);
      if (w.start >= now - STALE) ready.push(w);
    }
    ready.sort((a, b) => a.distance - b.distance);
    const out: T[] = [];
    for (const w of ready) {
      if (this.playingUntil.length >= MAX_WHISTLES) break;
      this.playingUntil.push(w.start + BOMB_WHISTLE_SECONDS / w.rate);
      out.push(w);
    }
    return out;
  }

  clear(): void {
    this.waiting.length = 0;
    this.playingUntil.length = 0;
  }
}
