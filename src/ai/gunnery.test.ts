import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { leadSolution } from './gunnery';
import { BULLET_DRAG_K } from '../sim/combat';
import { G } from './math';

/**
 * Fly one round the way src/sim/combat.ts does (quadratic drag, gravity, 120 Hz) along
 * `dir`, and return its closest approach to a target flying a level constant-rate turn.
 */
function missDistance(
  shooterPos: Vector3,
  shooterVel: Vector3,
  dir: Vector3,
  mv: number,
  target: (t: number) => Vector3,
): number {
  const p = shooterPos.clone();
  const v = shooterVel.clone().addScaledVector(dir, mv);
  const dt = 1 / 600;
  let best = Infinity;
  for (let t = 0; t < 2; t += dt) {
    const sp = v.length();
    v.multiplyScalar(Math.max(0, 1 - BULLET_DRAG_K * sp * dt));
    v.y -= G * dt;
    p.addScaledVector(v, dt);
    const d = p.distanceTo(target(t + dt));
    if (d < best) best = d;
    else if (d > best + 50) break;
  }
  return best;
}

/** A target circling level at speed v, turn rate w (rad/s), centre c, starting at angle a0. */
function circling(c: Vector3, radius: number, w: number, a0: number) {
  const pos = (t: number) => new Vector3(c.x + radius * Math.cos(a0 + w * t), c.y, c.z + radius * Math.sin(a0 + w * t));
  const vel = (t: number) => new Vector3(-radius * w * Math.sin(a0 + w * t), 0, radius * w * Math.cos(a0 + w * t));
  const acc = (t: number) => pos(t).sub(c).multiplyScalar(-w * w);
  return { pos, vel, acc };
}

describe('leadSolution against a turning target', () => {
  // A Camel-like target: 45 m/s in a 35 deg/s level turn (about 3 g).
  const w = (35 * Math.PI) / 180;
  const speed = 45;
  const radius = speed / w;
  const c = new Vector3(0, 2000, 0);
  const tgt = circling(c, radius, w, 0);

  for (const [range, tol] of [
    [150, 1.0],
    [250, 1.5],
    [400, 2.5],
  ] as const) {
    it(`puts the round within ${tol} m of the target at ${range} m (deflection shot inside its turn)`, () => {
      // The shooter sits `range` behind the target along a chord inside its circle, flying
      // at 50 m/s toward where the target is now.
      const tp = tgt.pos(0);
      const back = tgt.vel(0).normalize().multiplyScalar(-1);
      const inward = c.clone().sub(tp).normalize();
      const sp = tp.clone().addScaledVector(back.multiplyScalar(0.8).addScaledVector(inward, 0.6).normalize(), range);
      const sv = tp.clone().sub(sp).normalize().multiplyScalar(50);
      for (const mv of [745, 870]) {
        const sol = leadSolution(sp, sv, tp, tgt.vel(0), tgt.acc(0), mv);
        expect(missDistance(sp, sv, sol.dir, mv, tgt.pos)).toBeLessThan(tol);
      }
    });
  }

  it('the turn term matters: ignoring the target acceleration misses by well over a metre at 250 m', () => {
    const tp = tgt.pos(0);
    const sp = tp.clone().addScaledVector(tgt.vel(0).normalize(), -250);
    const sv = tgt.vel(0).normalize().multiplyScalar(50);
    const withAcc = leadSolution(sp, sv, tp, tgt.vel(0), tgt.acc(0), 745);
    const miss = missDistance(sp, sv, withAcc.dir, 745, tgt.pos);
    const noAcc = leadSolution(sp, sv, tp, tgt.vel(0), null, 745);
    const missNoAcc = missDistance(sp, sv, noAcc.dir, 745, tgt.pos);
    expect(miss).toBeLessThan(1.5);
    expect(missNoAcc).toBeGreaterThan(1.2);
    expect(miss).toBeLessThan(missNoAcc / 3);
  });

  it('time of flight includes the drag slow-down (a 400 m Vickers shot takes over 0.55 s)', () => {
    const sol = leadSolution(new Vector3(0, 1000, 0), new Vector3(), new Vector3(0, 1000, -400), new Vector3(), null, 745);
    expect(sol.tof).toBeGreaterThan(0.55);
    expect(sol.tof).toBeLessThan(0.7);
  });
});
