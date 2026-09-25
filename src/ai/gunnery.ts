/**
 * Lead-computing gunnery for fixed forward guns.
 *
 * Solves p_s + (v_s + mv*dir) t + 0.5 g t^2 = p_t + v_t t + 0.5 a_t t^2
 * for the unit aim direction `dir` by fixed-point iteration on t.
 */
import { Vector3 } from 'three';
import { BULLET_DRAG_K } from '../sim/combat';
import { G } from './math';

export interface LeadSolution {
  /** Unit aim direction (world) the gun line must point along. */
  dir: Vector3;
  /** Bullet time of flight, s. */
  tof: number;
  /** Predicted impact point. */
  point: Vector3;
}

const _rel = new Vector3();

export function leadSolution(
  shooterPos: Vector3,
  shooterVel: Vector3,
  targetPos: Vector3,
  targetVel: Vector3,
  targetAcc: Vector3 | null,
  muzzleVelocity: number,
  leadScale = 1,
  out: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() },
): LeadSolution {
  const mv = Math.max(muzzleVelocity, 100);
  // Rounds slow under quadratic drag (src/sim/combat.ts): a round launched at speed V
  // covers V*g(t) in time t, g(t) = ln(1 + kVt) / (kV). Solve for the "drag-free time" g
  // the aim vector needs, then convert back to real time of flight - without this the
  // solution under-leads by 10-20% at 200-400 m, which a hard-turning target punishes.
  const V = mv + Math.max(0, shooterVel.length());
  const kV = BULLET_DRAG_K * V;
  let t = shooterPos.distanceTo(targetPos) / mv;
  let g = t;
  for (let i = 0; i < 5; i++) {
    const tl = t * leadScale;
    _rel.copy(targetPos).sub(shooterPos);
    _rel.addScaledVector(targetVel, tl).addScaledVector(shooterVel, -g);
    if (targetAcc) _rel.addScaledVector(targetAcc, 0.5 * tl * tl);
    // Gravity drop: aim above by about 0.5 g t^2 (drag slows the fall a little too).
    _rel.y += 0.5 * G * t * g;
    g = _rel.length() / mv;
    t = kV > 0 ? Math.expm1(kV * g) / kV : g;
  }
  out.dir.copy(_rel).normalize();
  out.tof = t;
  out.point.copy(targetPos).addScaledVector(targetVel, t * leadScale);
  return out;
}

/** Angular radius of a target of given size at range, rad. */
export function angularRadius(radius: number, range: number): number {
  return Math.atan2(radius, Math.max(range, 1));
}
