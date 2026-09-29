import { describe, expect, it } from 'vitest';
import { createAIController, getAIPilot, releaseAIPilot, splitSide } from './controller';
import { perceptionOf } from './perception';
import { makeAircraft, TEST_REALISM } from './testing/testWorld';

describe('splitSide', () => {
  const ai = (id: number) => makeAircraft({ id, side: 'central', x: 0, z: 0, alt: 1500, heading: 0 });
  const player = (id: number) => makeAircraft({ id, side: 'allied', x: 0, z: -300, alt: 1500, heading: Math.PI, controller: 'player' });

  it('splits two AIs opposite ways by id', () => {
    const a = ai(1);
    const b = ai(2);
    expect(splitSide(a, b)).toBe(1);
    expect(splitSide(b, a)).toBe(-1);
  });

  // An AI flies the player's aircraft while he works a gun (and in the autoplayer). Every
  // other AI takes the up side against the player's aircraft, so its pilot must go down,
  // whichever has the lower id.
  for (const [pid, aid] of [
    [1, 2],
    [2, 1],
  ]) {
    it(`splits an AI and the AI-flown player's aircraft opposite ways (player id ${pid})`, () => {
      const p = player(pid);
      const a = ai(aid);
      expect(splitSide(a, p)).toBe(1);
      expect(splitSide(p, a)).toBe(-1);
    });
  }
});

describe('releaseAIPilot', () => {
  it('forgets the controller and its perception, so nothing reads the hand-back as AI-flown', () => {
    const p = makeAircraft({ id: 7, side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, controller: 'player' });
    createAIController(p, { role: 'player-flight', task: 'fighter-sweep', skill: 'regular', realism: TEST_REALISM, controlLaw: 'generic' });
    expect(getAIPilot(p)).toBeDefined();
    expect(perceptionOf(p)).toBeDefined();
    releaseAIPilot(p);
    expect(getAIPilot(p)).toBeUndefined();
    expect(perceptionOf(p)).toBeUndefined();
  });
});
