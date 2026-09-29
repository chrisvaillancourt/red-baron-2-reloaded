/**
 * The human-like pursuer (humanAim.ts) inside the controller: a shot he doesn't take, because
 * a friend is in the line of fire, must not count as a burst.
 */
import { describe, expect, it } from 'vitest';
import type { AircraftEntity } from '../core/types';
import { HUMAN_PILOT, type HumanAim } from './humanAim';
import { runSim, SimWorld } from './testing/realSimHarness';

/** Straight and level at full throttle. */
const straight = (ac: AircraftEntity) => {
  ac.controls.pitch = 0;
  ac.controls.roll = 0;
  ac.controls.yaw = 0;
  ac.controls.throttle = 1;
};

/** A human-aim SE5a 250 m behind a straight-flying Albatros, optionally with a friend between. */
function run(blocked: boolean) {
  const w = new SimWorld({ seed: 1, frontX: -1e6, realFront: false });
  const shooter = w.addAircraft({ aircraftId: 'se5a', side: 'allied', x: 0, z: 0, alt: 1800, heading: 0 });
  const ctl = w.addAI(shooter, 'veteran', { seed: 1, human: HUMAN_PILOT, avoidCollisions: false });
  const target = w.addAircraft({ aircraftId: 'se5a', side: 'central', x: 0, z: -250, alt: 1800, heading: 0, controller: 'player' });
  const scripted = new Map([[target.id, straight]]);
  if (blocked) {
    const friend = w.addAircraft({ aircraftId: 'se5a', side: 'allied', x: 0, z: -120, alt: 1800, heading: 0, controller: 'player' });
    scripted.set(friend.id, straight);
  }
  const human = (ctl as unknown as { human: HumanAim }).human;
  let fired = false;
  let tracked = false;
  runSim(w, 4, {
    scripted,
    onStep: () => {
      fired ||= shooter.controls.fireGuns;
      tracked ||= human.tracking(target.id, (ctl as unknown as { now: number }).now);
    },
  });
  return { fired, tracked, burstUntil: human.burstUntil };
}

describe('the human-like pursuer', () => {
  it('opens fire on a target dead ahead', () => {
    const r = run(false);
    expect(r.tracked).toBe(true);
    expect(r.fired).toBe(true);
  });

  it('starts no burst while a friend is in the line of fire', () => {
    const r = run(true);
    expect(r.tracked).toBe(true);
    expect(r.fired).toBe(false);
    expect(r.burstUntil).toBe(0);
  });
});
