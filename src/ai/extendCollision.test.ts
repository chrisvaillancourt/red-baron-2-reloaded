import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createAIController } from './controller';
import { TestWorld, makeAircraft, TEST_REALISM } from './testing/testWorld';

// Two AIs closing head-on 150 m apart (about 1.5 s to closest approach), B inverted `above`
// metres above A, so each has the other on its own lift side. Returns each steer direction's
// component along that aircraft's own lift axis: positive means it pulls toward its lift.
function liftComponents(bExtends: boolean, ids: [number, number] = [9001, 9002], above = 20) {
  const world = new TestWorld();
  const a = makeAircraft({ id: ids[0], side: 'allied', x: 0, z: 0, alt: 1000, heading: 0, speed: 50 });
  const b = makeAircraft({ id: ids[1], side: 'central', x: 10, z: -150, alt: 1000 + above, heading: Math.PI, speed: 50 });
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

// Both AIs extending, A rolled `rollA` and B inverted then rolled `rollB` about their noses,
// B `above` metres higher and `lateral` metres to the side, about 1.5 s to closest approach.
function pairLift(rollA: number, rollB: number, above: number, lateral: number) {
  const world = new TestWorld();
  const a = makeAircraft({ id: 9001, side: 'allied', x: 0, z: 0, alt: 1000, heading: 0, speed: 50 });
  const b = makeAircraft({ id: 9002, side: 'central', x: lateral, z: -150, alt: 1000 + above, heading: Math.PI, speed: 50 });
  for (const [ac, roll] of [[a, rollA], [b, Math.PI + rollB]] as const) {
    ac.state.orientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation), roll));
  }
  world.aircraft.push(a, b);
  const options = { skill: 'regular', realism: TEST_REALISM } as Parameters<typeof createAIController>[1];
  const pilots = [createAIController(a, options), createAIController(b, options)];
  for (const p of pilots) p.phase = 'extend';
  return ([a, b] as const).map((self, i) => {
    const steer = { dir: new Vector3(0, 0, -1).applyQuaternion(self.state.orientation), speed: Infinity };
    (pilots[i] as unknown as { avoidCollisions(s: typeof a, w: TestWorld, st: typeof steer): void }).avoidCollisions(self, world, steer);
    return steer.dir.dot(new Vector3(0, 1, 0).applyQuaternion(self.state.orientation));
  });
}

describe('collision escape while both aircraft extend (D-115)', () => {
  // Each aircraft projects the offset on its own lift axis; with unequal rolls or a height
  // offset those differ, so a per-aircraft threshold let one pull across and one escape.
  it('makes one shared choice under unequal rolls and height offsets', () => {
    let mutual = 0;
    for (const rollA of [-0.5, -0.25, 0, 0.3]) {
      for (const rollB of [-0.4, 0, 0.2, 0.5]) {
        for (const above of [6, 10, 14, 18, 24]) {
          for (const lateral of [-8, 0, 6]) {
            const [la, lb] = pairLift(rollA, rollB, above, lateral);
            if (Math.abs(la) < 0.05 && Math.abs(lb) < 0.05) continue;
            mutual++;
            expect(Math.sign(la), `rolls ${rollA}/${rollB}, above ${above}, lateral ${lateral}`).toBe(Math.sign(lb));
          }
        }
      }
    }
    expect(mutual).toBeGreaterThan(100);
  });

  // Never one pulling across while the other escapes away: the crosser chases the other.
  it('has both of two extending AIs escape away when one pull cannot cover the offset', () => {
    const r = liftComponents(true);
    expect(r.a).toBeLessThan(0);
    expect(r.b).toBeLessThan(0);
  });

  it('has both pull across when the offset is small', () => {
    const r = liftComponents(true, [9001, 9002], 4);
    expect(r.a).toBeGreaterThan(0);
    expect(r.b).toBeGreaterThan(0);
  });

  it('keeps the reflection for a lone extender', () => {
    expect(liftComponents(false).a).toBeGreaterThan(0);
  });

  it('makes the same choice whatever the ids or list order', () => {
    for (const above of [4, 20]) {
      const r = liftComponents(true, [9012, 9011], above);
      expect(Math.sign(r.a)).toBe(Math.sign(r.b));
    }
  });
});
