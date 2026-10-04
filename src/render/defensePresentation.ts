import type { PerspectiveCamera, Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { DefenseEvent, DefenseInput, DefenseState, DefenseWeaponId } from '../core/defense';

/** First-person battery presentation. Owns production world/aircraft resources.
 * Local simulation coordinates are translated by origin only here. The visual barrel
 * and getAim share exactly one muzzle/ray; focus changes both projections together.
 */
export interface DefensePresentation {
  readonly camera: PerspectiveCamera;
  readonly world: WorldQuery;
  readonly origin: Vector3;
  setView(yaw: number, pitch: number, focused: boolean, weapon: DefenseWeaponId, fuzeRange: number): void;
  /** Writes into caller-owned vectors. Does not change input.fire. */
  getAim(input: DefenseInput): void;
  /** Updates live production visuals and consumes simulation events once. */
  update(state: DefenseState, events: readonly DefenseEvent[], dt: number): void;
  render(): void;
  resize(width: number, height: number): void;
  /** Writes NDC coordinates of a local point; false if behind camera/out of view. */
  project(local: Vector3, out: Vector3): boolean;
  dispose(): void;
}
