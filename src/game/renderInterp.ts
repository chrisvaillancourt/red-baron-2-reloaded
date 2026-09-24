/**
 * Render-state interpolation between fixed sim steps.
 *
 * The sim runs at 120 Hz; displays run at 60, 120 or 144 Hz with jittery
 * rAF timing, so a frame may see 0, 1 or 2 new steps. Drawing the latest
 * step makes motion stutter (worst in chase view and on ProMotion panels).
 * Instead each aircraft's pose is blended between the previous and the
 * current step by the accumulator fraction, just for the draw, then the
 * true state is restored so the sim, AI and HUD never see blended values.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity } from '../core/types';

interface Pose {
  prevPos: Vector3;
  prevQuat: Quaternion;
  truePos: Vector3;
  trueQuat: Quaternion;
  valid: boolean;
}

export class RenderInterpolator {
  private poses = new Map<number, Pose>();
  private applied: AircraftEntity[] = [];

  /** Call before every sim step: remembers the pose the step starts from. */
  capture(aircraft: readonly AircraftEntity[]): void {
    for (const ac of aircraft) {
      let p = this.poses.get(ac.id);
      if (!p) {
        p = { prevPos: new Vector3(), prevQuat: new Quaternion(), truePos: new Vector3(), trueQuat: new Quaternion(), valid: false };
        this.poses.set(ac.id, p);
      }
      p.prevPos.copy(ac.state.position);
      p.prevQuat.copy(ac.state.orientation);
      p.valid = true;
    }
  }

  /** Blend poses for drawing; alpha in [0,1] is the accumulator fraction of a step. */
  apply(aircraft: readonly AircraftEntity[], alpha: number): void {
    const a = Math.min(1, Math.max(0, alpha));
    this.applied.length = 0;
    for (const ac of aircraft) {
      const p = this.poses.get(ac.id);
      if (!p || !p.valid) continue;
      // Wrecks and teleports (spawns) snap rather than smear.
      if (p.prevPos.distanceToSquared(ac.state.position) > 100 * 100) continue;
      p.truePos.copy(ac.state.position);
      p.trueQuat.copy(ac.state.orientation);
      ac.state.position.lerpVectors(p.prevPos, p.truePos, a);
      ac.state.orientation.slerpQuaternions(p.prevQuat, p.trueQuat, a);
      this.applied.push(ac);
    }
  }

  /** Put the true sim state back. Must follow every apply(). */
  restore(): void {
    for (const ac of this.applied) {
      const p = this.poses.get(ac.id)!;
      ac.state.position.copy(p.truePos);
      ac.state.orientation.copy(p.trueQuat);
    }
    this.applied.length = 0;
  }

  forget(id: number): void {
    this.poses.delete(id);
  }
}
