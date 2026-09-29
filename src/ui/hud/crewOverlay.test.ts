import { describe, expect, it } from 'vitest';
import { bombsText, cueText, polylinePath, seatText } from './crewOverlay';
import type { HudBombsight } from './types';

const sight = (o: Partial<HudBombsight>): HudBombsight => ({ impact: null, driftAngle: 0, wire: [], cue: 'none', timeToRelease: null, crossM: 0, target: null, releaseKey: 'R', ...o });

describe('bombsight cue', () => {
  it('counts down the run-in and says which way to steer', () => {
    expect(cueText(sight({ cue: 'run-in', timeToRelease: 12.4, crossM: -60 }), 'metric')).toBe('RUN-IN · 12 s · STEER LEFT 60 m');
    expect(cueText(sight({ cue: 'run-in', timeToRelease: 12.4, crossM: 80 }), 'imperial')).toBe('RUN-IN · 12 s · STEER RIGHT 260 ft');
    expect(cueText(sight({ cue: 'run-in', timeToRelease: 3, crossM: 5 }), 'metric')).toBe('RUN-IN · 3 s · STEADY');
  });

  it('calls the release with its key, the overshoot and no target', () => {
    expect(cueText(sight({ cue: 'release' }), 'metric')).toBe('RELEASE — R');
    expect(cueText(sight({ cue: 'past' }), 'metric')).toBe('OVERSHOT — COME ROUND AGAIN');
    expect(cueText(sight({ cue: 'none' }), 'metric')).toBe('NO TARGET ON THE TRACK');
  });
});

describe('seat and bomb labels', () => {
  it('names the seat, its place and who flies', () => {
    expect(seatText({ label: 'Observer', index: 2, count: 2, aiFlying: true })).toBe('OBSERVER 2/2 · PILOT FLYING');
    expect(seatText({ label: 'Pilot', index: 1, count: 2, aiFlying: false })).toBe('PILOT 1/2');
  });

  it('counts the bombs and names the next', () => {
    expect(bombsText({ left: 3, total: 4, next: '112 lb R.L.' })).toBe('BOMBS 3/4 · 112 lb R.L.');
    expect(bombsText({ left: 0, total: 4, next: null })).toBe('BOMBS 0/4');
  });
});

describe('arc edge paths', () => {
  it('draws each polyline in pixels', () => {
    expect(polylinePath([[{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }], [{ x: 1, y: 1 }]], 200, 100)).toBe('M0.0 0.0L100.0 25.0');
  });
});
