import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createAIController } from './controller';
import { TestWorld, makeAircraft, TEST_REALISM } from './testing/testWorld';

// Two AIs closing head-on 150 m apart (about 1.5 s to closest approach), B inverted 20 m
// above A, so each has the other on its own lift side. Returns each steer direction's
// component along that aircraft's own lift axis: positive means it pulls toward its lift.
function liftComponents(bExtends: boolean, ids: [number, number] = [9001, 9002]) {
  const world = new TestWorld();
  const a = makeAircraft({ id: ids[0], side: 'allied', x: 0, z: 0, alt: 1000, heading: 0, speed: 50 });
  const b = makeAircraft({ id: ids[1], side: 'central', x: 10, z: -150, alt: 1020, heading: Math.PI, speed: 50 });
  const forwardB = new Vector3(0, 0, -1).applyQuaternion(b.state.orientation);
  b.state.orientation.premultiply(new Quaternion().setFromAxisAngle(forwardB, Math.PI));
  world.aircraft.push(a, b);
  const options = { skill: 'regular', realism: TEST_REALISM } as Parameters<typeof createAIController>[1];
  const pilotA = createAIController(a, options);
  const pilotB = createAIController(b, options);
  pilotA.phase = 'extend';
  pilotB.phase = bExtends ? 'extend' : 'engage';
  const lift = (pilot: typeof pilotA, self: typeof a) => {
    const steer = { dir: new Vector3(0, 0, -1).applyQuaternion(self.state.orientation), speed: Infinity };
    (pilot as unknown as { avoidCollisions(s: typeof a, w: TestWorld, st: typeof steer): void })
      .avoidCollisions(self, world, steer);
    return steer.dir.dot(new Vector3(0, 1, 0).applyQuaternion(self.state.orientation));
  };
  return { a: lift(pilotA, a), b: lift(pilotB, b) };
}

describe('collision escape while both aircraft extend (D-115)', () => {
  it('lets exactly one of two extending AIs pull across toward the other', () => {
    const r = liftComponents(true);
    expect(r.a).toBeGreaterThan(0);
    expect(r.b).toBeLessThan(0);
  });

  it('keeps the reflection for a lone extender', () => {
    expect(liftComponents(false).a).toBeGreaterThan(0);
  });

  it('chooses the crosser by id, not by list order', () => {
    const r = liftComponents(true, [9012, 9011]);
    expect(r.a).toBeLessThan(0);
    expect(r.b).toBeGreaterThan(0);
  });
});
