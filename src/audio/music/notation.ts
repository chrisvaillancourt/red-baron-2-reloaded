/**
 * Tiny text notation for the procedural score.
 *
 *   token   := pitch(+pitch)*[*hits]:beats[@velocity]
 *   pitch   := R (rest) | X (unpitched hit) | C4, F#3, Bb2 ...
 *   *hits   := roll: `hits` evenly spaced strokes across `beats`, crescendo
 *
 * Examples: "C4+E4+G4:4"  "G4:0.75 G4:0.25"  "X*16:4@0.5"  "R:2"
 * Bar lines "|" are ignored (they're only for readability).
 */

export interface NoteEvent {
  /** Start, in beats from the start of the track. */
  beat: number;
  beats: number;
  /** Frequencies in Hz; empty for unpitched hits. */
  freqs: number[];
  velocity: number;
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad pitch "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + SEMITONES[m[1]] + acc;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function parseTrack(src: string, transpose = 0, velocityScale = 1): NoteEvent[] {
  const out: NoteEvent[] = [];
  let beat = 0;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const m = /^([^:*@]+)(?:\*(\d+))?:([\d.]+)(?:@([\d.]+))?$/.exec(tok);
    if (!m) throw new Error(`Bad token "${tok}"`);
    const beats = Number(m[3]);
    const vel = (m[4] ? Number(m[4]) : 1) * velocityScale;
    const pitches = m[1].split('+');
    if (pitches[0] !== 'R') {
      const freqs = pitches[0] === 'X' ? [] : pitches.map((p) => midiToFreq(midiOf(p) + transpose));
      const hits = m[2] ? Number(m[2]) : 1;
      for (let h = 0; h < hits; h++) {
        const crescendo = hits > 1 ? 0.35 + 0.65 * (h / (hits - 1)) : 1;
        out.push({ beat: beat + (h * beats) / hits, beats: beats / hits, freqs, velocity: vel * crescendo });
      }
    }
    beat += beats;
  }
  return out;
}

/** Total length of a track in beats (including trailing rests). */
export function trackLength(src: string): number {
  let beat = 0;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const m = /:([\d.]+)/.exec(tok);
    if (m) beat += Number(m[1]);
  }
  return beat;
}

export function repeat(src: string, times: number): string {
  return Array.from({ length: times }, () => src).join(' ');
}
