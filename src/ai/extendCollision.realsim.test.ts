import { describe, expect, it } from 'vitest';
import { runExtendEncounter } from './testing/extendEncounter';

// Two Camels at knife-edge, each with the other on its own lift side, both breaking into
// `extend` at once (the review encounter for D-115's mutual case). Electing one of them to
// pull across while the other escaped away rammed them; the pair has to choose together.
describe('two AIs extending into each other (real flight and combat)', () => {
  it('keep clear in the knife-edge head-on pass', () => {
    const r = runExtendEncounter({ offsetX: 12 });
    expect(r.bothExtended).toBe(true);
    // No separation floor beyond contact: every escape rule tried passes within about a
    // metre of the Camels' combined collision radii (6.5 m) in this geometry.
    expect(r.collisions).toBe(0);
  });
});
