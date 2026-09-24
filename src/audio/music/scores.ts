/**
 * Original period-flavoured compositions (written for this project; no
 * existing tunes quoted). Written in the notation of ./notation.ts.
 */
import type { MusicCue } from '../../core/interfaces';
import { repeat } from './notation';

export type InstrumentName =
  | 'brass'
  | 'horn'
  | 'strings'
  | 'organ'
  | 'piano'
  | 'tuba'
  | 'lowstrings'
  | 'snare'
  | 'kick'
  | 'cymbal'
  | 'timpani';

export interface TrackDef {
  instrument: InstrumentName;
  notes: string;
  /** Semitone transpose applied on top of the score transpose. */
  transpose?: number;
  gain?: number;
}

export interface ScoreDef {
  name: string;
  bpm: number;
  /** Semitones applied to every pitched track. */
  transpose: number;
  loop: boolean;
  /** Seconds of reverb tail to allow after a non-looping score. */
  tail: number;
  /** Length in beats; all tracks must match it. */
  lengthBeats: number;
  tracks: TrackDef[];
  /** Overall gain of the piece. */
  gain: number;
}

// --- "The Dawn Patrol" — march for the main menu (written in C, played in B-flat).
const MARCH_MELODY = [
  'G4:0.75 G4:0.25 C5:1 E5:1 G5:1',
  'F5:1.5 E5:0.5 D5:1 C5:1',
  'D5:0.75 D5:0.25 E5:1 F5:1 A5:1',
  'G5:3 R:1',
  'A5:1.5 G5:0.5 F5:1 E5:1',
  'F5:1.5 E5:0.5 D5:1 C5:1',
  'D5:1 E5:0.5 F5:0.5 E5:1 D5:1',
  'G4:3 R:1',
  'G4:0.75 G4:0.25 C5:1 E5:1 G5:1',
  'C6:1.5 B5:0.5 A5:1 G5:1',
  'F5:1 A5:1 G5:1 E5:1',
  'D5:3 R:1',
  'E5:0.75 E5:0.25 F5:1 G5:1 A5:1',
  'G5:1 F5:1 E5:1 D5:1',
  'C5:1 E5:1 D5:1 B4:1',
  'C5:3 R:1',
].join(' | ');

const MARCH_CHORDS = [
  'E3+G3+C4:4',
  'F3+A3+C4:2 E3+G3+C4:2',
  'D3+F3+A3:4',
  'D3+G3+B3:4',
  'F3+A3+C4:4',
  'D3+F3+A3:2 E3+G3+C4:2',
  'D3+F3+G3+B3:4',
  'D3+G3+B3:4',
  'E3+G3+C4:4',
  'A3+C4+E4:2 G3+C4+E4:2',
  'F3+A3+C4:2 E3+G3+C4:2',
  'D3+G3+B3:4',
  'E3+G3+C4:2 F3+A3+C4:2',
  'E3+G3+C4:2 D3+G3+B3:2',
  'E3+G3+C4:2 D3+F3+B3:2',
  'E3+G3+C4:4',
].join(' | ');

const MARCH_BASS = [
  'C3:1 G2:1 C3:1 G2:1',
  'F2:1 C3:1 C3:1 G2:1',
  'D3:1 A2:1 D3:1 A2:1',
  'G2:1 D3:1 G2:1 D3:1',
  'F2:1 C3:1 F2:1 C3:1',
  'D3:1 A2:1 C3:1 G2:1',
  'G2:1 D3:1 G2:1 B2:1',
  'G2:1 D3:1 G2:1 D3:1',
  'C3:1 G2:1 C3:1 G2:1',
  'A2:1 E3:1 C3:1 G2:1',
  'F2:1 C3:1 C3:1 G2:1',
  'G2:1 D3:1 G2:1 D3:1',
  'C3:1 G2:1 F2:1 C3:1',
  'C3:1 G2:1 G2:1 D3:1',
  'C3:1 G2:1 G2:1 B2:1',
  'C3:1 G2:1 C3:2',
].join(' | ');

const MARCH_SNARE_BAR = 'X:0.5@0.9 X:0.25@0.5 X:0.25@0.6 X:0.5@0.8 X:0.5@0.6 X*4:0.5@0.7 X:0.5@0.7 X:1@1';

const MENU: ScoreDef = {
  name: 'The Dawn Patrol',
  bpm: 112,
  transpose: -2,
  loop: true,
  tail: 0,
  lengthBeats: 64,
  gain: 0.8,
  tracks: [
    { instrument: 'brass', notes: MARCH_MELODY, gain: 0.55 },
    { instrument: 'horn', notes: MARCH_MELODY, transpose: -12, gain: 0.3 },
    { instrument: 'organ', notes: MARCH_CHORDS, gain: 0.22 },
    { instrument: 'tuba', notes: MARCH_BASS, gain: 0.5 },
    { instrument: 'snare', notes: repeat(MARCH_SNARE_BAR, 16), gain: 0.28 },
    { instrument: 'kick', notes: repeat('X:1 R:1 X:1@0.7 R:1', 16), gain: 0.45 },
    { instrument: 'cymbal', notes: 'X:32 X:32', gain: 0.18 },
  ],
};

// --- "Orders from Wing" — tense briefing ostinato in D minor.
const BRIEF_PULSE = ['D2', 'Bb1', 'G1', 'A1'].map((n) => repeat(`${n}:0.5`, 8)).join(' | ');
const BRIEFING: ScoreDef = {
  name: 'Orders from Wing',
  bpm: 76,
  transpose: 0,
  loop: true,
  tail: 0,
  lengthBeats: 32,
  gain: 0.75,
  tracks: [
    { instrument: 'lowstrings', notes: repeat(BRIEF_PULSE, 2), gain: 0.4 },
    { instrument: 'strings', notes: repeat('D3+F3+A3:4 D3+F3+Bb3:4 D3+G3+Bb3:4 C#3+E3+A3:4', 2), gain: 0.25 },
    {
      instrument: 'horn',
      notes: 'A4:3 F4:1 | D5:2 C5:1 Bb4:1 | A4:4 | E4:2 C#5:2 | A4:1.5 Bb4:0.5 A4:1 G4:1 | F4:2 D5:2 | D5:1 Bb4:1 G4:1 E4:1 | A4:4',
      gain: 0.42,
    },
    { instrument: 'timpani', notes: repeat('D2:4 Bb1:4 G1:4 A1:2 A1*8:2@0.6', 2), gain: 0.4 },
    { instrument: 'snare', notes: repeat('R:12 X*16:4@0.35', 2), gain: 0.22 },
  ],
};

// --- "Lament for the Fallen" — slow chorale in C minor for defeat & memorials.
const DEFEAT: ScoreDef = {
  name: 'Lament for the Fallen',
  bpm: 58,
  transpose: 0,
  loop: true,
  tail: 0,
  lengthBeats: 48,
  gain: 0.8,
  tracks: [
    { instrument: 'horn', notes: 'G4:2 Ab4:1 G4:1 | C5:3 Bb4:1 | Ab4:2 G4:1 F4:1 | G4:4 | Eb5:2 D5:1 C5:1 | Ab4:2 C5:2 | B4:2 D5:1 B4:1 | C5:4 | R:16', gain: 0.45 },
    { instrument: 'strings', notes: 'C3+Eb3+G3:4 | C3+Eb3+Ab3:4 | C3+F3+Ab3:4 | B2+D3+G3:4 | C3+Eb3+G3:4 | C3+F3+Ab3:4 | B2+D3+G3:4 | C3+Eb3+G3:4 | R:16', gain: 0.3 },
    {
      instrument: 'piano',
      notes: 'C3:1 G3:1 Eb4:1 G3:1 | Ab2:1 Eb3:1 C4:1 Eb3:1 | F2:1 C3:1 Ab3:1 C3:1 | G2:1 D3:1 B3:1 D3:1 | C3:1 G3:1 Eb4:1 G3:1 | F2:1 C3:1 Ab3:1 C3:1 | G2:1 D3:1 B3:1 D3:1 | C3:1 G3:1 C4:2 | R:16',
      gain: 0.3,
    },
    { instrument: 'kick', notes: 'X:4@0.5 R:44', gain: 0.4 },
  ],
};

// --- "Victory Roll" — triumphant fanfare (C written, played in D).
const FANFARE_TRACKS = (lead: string): TrackDef[] => [
  { instrument: 'brass', notes: `${lead}C5:0.5 E5:0.5 G5:0.5 C6:0.5 G5:1 E5:1 | F5:0.5 A5:0.5 C6:1 A5:1 F5:1 | G5:0.5 G5:0.5 G5:0.5 A5:0.5 B5:1 D6:1 | C6:4`, gain: 0.55 },
  { instrument: 'horn', notes: `${lead}E4:0.5 G4:0.5 C5:0.5 E5:0.5 E5:1 C5:1 | C5:0.5 F5:0.5 A5:1 F5:1 C5:1 | D5:0.5 D5:0.5 D5:0.5 F5:0.5 G5:1 B5:1 | E5+G5:4`, gain: 0.35 },
  { instrument: 'organ', notes: `${lead}C3+E3+G3+C4:4 F3+A3+C4:4 G3+B3+D4:4 C3+E3+G3+C4:4`, gain: 0.2 },
  { instrument: 'tuba', notes: `${lead}C2:1 C3:1 C2:1 G2:1 | F2:2 C3:2 | G2:2 G2:2 | C2:4`, gain: 0.5 },
  { instrument: 'timpani', notes: `${lead}C2:1 G2:1 C2:2 | F2:2 C2:2 | G2*12:4 | C2:4`, gain: 0.45 },
  { instrument: 'cymbal', notes: `${lead}R:12 X:4`, gain: 0.25 },
];

const VICTORY: ScoreDef = {
  name: 'Victory Roll',
  bpm: 116,
  transpose: 2,
  loop: false,
  tail: 3,
  lengthBeats: 16,
  gain: 0.85,
  tracks: [...FANFARE_TRACKS(''), { instrument: 'snare', notes: 'X:0.5 X:0.5 X:1 X:2 | R:4 | X*16:4@0.7 | X:4', gain: 0.25 }],
};

// --- "Pour le Mérite" — drum roll, then the fanfare, for medal ceremonies.
const MEDAL: ScoreDef = {
  ...VICTORY,
  name: 'Pour le Mérite',
  lengthBeats: 24,
  tracks: [...FANFARE_TRACKS('R:8 '), { instrument: 'snare', notes: 'X*48:8@0.9 X:0.5 X:0.5 X:1 X:2 | R:4 | X*16:4@0.7 | X:4', gain: 0.25 }],
};

export const SCORES: Partial<Record<MusicCue, ScoreDef>> = {
  menu: MENU,
  briefing: BRIEFING,
  defeat: DEFEAT,
  victory: VICTORY,
  medal: MEDAL,
};
