/**
 * Look-ahead score sequencer with crossfades between cues.
 */
import type { MusicCue } from '../../core/interfaces';
import { playNote, type InstrumentKit } from './instruments';
import { parseTrack, type NoteEvent } from './notation';
import { SCORES, type InstrumentName, type ScoreDef } from './scores';

interface CompiledTrack {
  instrument: InstrumentName;
  gain: number;
  notes: NoteEvent[];
}

export interface CompiledScore {
  def: ScoreDef;
  tracks: CompiledTrack[];
  secPerBeat: number;
  lengthSec: number;
}

export function compileScore(def: ScoreDef): CompiledScore {
  return {
    def,
    secPerBeat: 60 / def.bpm,
    lengthSec: (def.lengthBeats * 60) / def.bpm,
    tracks: def.tracks.map((t) => ({
      instrument: t.instrument,
      gain: (t.gain ?? 1) * def.gain,
      notes: parseTrack(t.notes, def.transpose + (t.transpose ?? 0)),
    })),
  };
}

/** Schedule every note of one pass of `score` whose start falls in [from, to) (seconds, relative to passStart). */
export function scheduleWindow(
  ctx: BaseAudioContext,
  dest: AudioNode,
  kit: InstrumentKit,
  score: CompiledScore,
  passStart: number,
  from: number,
  to: number,
): void {
  for (const track of score.tracks) {
    for (const n of track.notes) {
      const s = n.beat * score.secPerBeat;
      if (s < from || s >= to) continue;
      playNote(ctx, dest, kit, track.instrument, n.freqs, passStart + s, n.beats * score.secPerBeat, n.velocity * track.gain);
    }
  }
}

interface Playing {
  cue: MusicCue;
  score: CompiledScore;
  out: GainNode;
  passStart: number;
  scheduledTo: number; // seconds into the current pass already scheduled
  finished: boolean;
}

const LOOKAHEAD = 0.25;
const TICK_MS = 50;
const FADE = 1.2;

export class MusicPlayer {
  private playing: Playing | null = null;
  private readonly compiled = new Map<MusicCue, CompiledScore>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly kit: InstrumentKit,
  ) {}

  get currentCue(): MusicCue {
    return this.playing && !this.playing.finished ? this.playing.cue : 'none';
  }

  play(cue: MusicCue): void {
    if (this.playing && this.playing.cue === cue && !this.playing.finished) return;
    this.fadeOutCurrent();
    const def = SCORES[cue];
    if (!def) return; // 'flight' and 'none' are silence.
    let score = this.compiled.get(cue);
    if (!score) {
      score = compileScore(def);
      this.compiled.set(cue, score);
    }
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, this.ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.4);
    out.connect(this.dest);
    this.playing = { cue, score, out, passStart: this.ctx.currentTime + 0.1, scheduledTo: 0, finished: false };
    this.ensureTimer();
    this.tick();
  }

  stop(): void {
    this.fadeOutCurrent();
  }

  dispose(): void {
    this.fadeOutCurrent();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private fadeOutCurrent(): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    const now = this.ctx.currentTime;
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.linearRampToValueAtTime(0, now + FADE);
    setTimeout(() => p.out.disconnect(), (FADE + 4) * 1000);
  }

  private ensureTimer(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const p = this.playing;
    if (!p || p.finished) return;
    const horizonAbs = this.ctx.currentTime + LOOKAHEAD;
    const len = p.score.lengthSec;
    while (p.scheduledTo < horizonAbs - p.passStart) {
      const to = Math.min(horizonAbs - p.passStart, len);
      scheduleWindow(this.ctx, p.out, this.kit, p.score, p.passStart, p.scheduledTo, to);
      p.scheduledTo = to;
      if (to >= len) {
        if (!p.score.def.loop) {
          p.finished = true;
          return;
        }
        p.passStart += len;
        p.scheduledTo = 0;
        continue;
      }
      break;
    }
  }
}
