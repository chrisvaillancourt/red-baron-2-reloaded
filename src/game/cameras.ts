/**
 * Camera rig: cockpit (head look + snap views), chase, padlock (RB2's
 * signature view), fly-by, target-to-player and free orbit.
 */
import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { AircraftEntity, Entity } from '../core/types';
import type { WorldQuery } from '../core/interfaces';
import type { InputFrame } from './input';

export type CameraMode = 'cockpit' | 'chase' | 'padlock' | 'flyby' | 'target' | 'orbit';

export const NECK_YAW_LIMIT = MathUtils.degToRad(165);
export const NECK_PITCH_MIN = MathUtils.degToRad(-40);
export const NECK_PITCH_MAX = MathUtils.degToRad(88);
const PADLOCK_DROP_RANGE = 9000;

export function entityPosition(e: Entity): Vector3 {
  return e.kind === 'aircraft' ? e.state.position : e.position;
}

export function isAlive(e: Entity): boolean {
  if (e.kind === 'aircraft') return e.outcome === null;
  return !e.destroyed;
}

/**
 * Head yaw/pitch (yaw + = left, pitch + = up) needed to look at `target`
 * from the aircraft, in the aircraft's body frame.
 */
export function headAnglesTo(ac: AircraftEntity, target: Vector3, eye: Vector3): { yaw: number; pitch: number } {
  const inv = ac.state.orientation.clone().invert();
  const eyeWorld = eye.clone().applyQuaternion(ac.state.orientation).add(ac.state.position);
  const d = target.clone().sub(eyeWorld).applyQuaternion(inv);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/**
 * Crude structural obstruction test for the padlock indicator: nose/lower
 * wing below-forward, upper wing above-forward for biplanes/triplanes.
 */
export function isObstructed(ac: AircraftEntity, yaw: number, pitch: number): boolean {
  const ay = Math.abs(yaw);
  if (pitch < MathUtils.degToRad(-12) && ay < MathUtils.degToRad(70)) return true; // nose / lower wing
  const layout = ac.spec.geometry.layout;
  if ((layout === 'biplane' || layout === 'sesquiplane' || layout === 'triplane' || layout === 'parasol') && pitch > MathUtils.degToRad(18) && pitch < MathUtils.degToRad(55) && ay < MathUtils.degToRad(75) && ay > MathUtils.degToRad(12))
    return true; // upper wing (centre cut-out stays clear)
  if (ay > NECK_YAW_LIMIT) return true; // directly behind: tail/headrest
  return false;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'cockpit';
  padlockId: number | null = null;
  targetId: number | null = null;
  padlockObstructed = false;
  headYaw = 0;
  headPitch = 0;
  private chaseQuat = new Quaternion();
  private chaseInit = false;
  private flybyPos: Vector3 | null = null;
  private orbitYaw = Math.PI;
  private orbitPitch = 0.25;
  private orbitDist = 25;
  private shakeT = 0;
  private freeYaw = 0;
  private freePitch = 0;
  private freeLookActive = false;

  /** Re-centre the head (e.g. on view change or "look forward"). */
  centreHead(): void {
    this.freeYaw = 0;
    this.freePitch = 0;
    this.freeLookActive = false;
  }

  constructor(fovDeg: number, aspect: number, near = 0.2, far = 60000) {
    this.camera = new PerspectiveCamera(fovDeg, aspect, near, far);
  }

  setFov(fovDeg: number): void {
    this.camera.fov = fovDeg;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get inCockpit(): boolean {
    return this.mode === 'cockpit' || this.mode === 'padlock';
  }

  /** Whether mouse movement should steer (vs. look around) in this view. */
  get mouseSteers(): boolean {
    // Padlock too: the view tracks the target while the mouse keeps flying the aeroplane.
    return this.mode !== 'orbit';
  }

  setMode(mode: CameraMode, world?: WorldQuery, player?: AircraftEntity | null): void {
    if (mode === 'padlock' && this.padlockId === null && world && player) this.padlockNearest(world, player);
    if (mode === 'padlock' && this.padlockId === null) mode = 'cockpit';
    if (mode === 'flyby') this.flybyPos = null;
    this.mode = mode;
  }

  /** Candidate contacts sorted by distance: enemies first, then friendlies. */
  private candidates(world: WorldQuery, player: AircraftEntity): Entity[] {
    const p = player.state.position;
    const list: Entity[] = [];
    for (const a of world.aircraft) if (a.id !== player.id && a.outcome === null) list.push(a);
    for (const b of world.balloons) if (!b.destroyed) list.push(b);
    const score = (e: Entity) => entityPosition(e).distanceTo(p) + (e.side === player.side ? 1e6 : 0) + (e.kind === 'balloon' ? 2e5 : 0);
    return list.filter((e) => entityPosition(e).distanceTo(p) < PADLOCK_DROP_RANGE).sort((a, b) => score(a) - score(b));
  }

  padlockNearest(world: WorldQuery, player: AircraftEntity): void {
    const c = this.candidates(world, player);
    this.padlockId = c[0]?.id ?? null;
    this.targetId = this.padlockId;
  }

  cycleTarget(world: WorldQuery, player: AircraftEntity): void {
    const c = this.candidates(world, player);
    if (c.length === 0) {
      this.targetId = null;
      return;
    }
    const idx = c.findIndex((e) => e.id === this.targetId);
    this.targetId = c[(idx + 1) % c.length].id;
    if (this.mode === 'padlock') this.padlockId = this.targetId;
  }

  update(dt: number, player: AircraftEntity, world: WorldQuery, eye: Vector3, input: InputFrame | null): void {
    const cam = this.camera;
    const s = player.state;
    const q = s.orientation;

    // Validate locks.
    if (this.padlockId !== null) {
      const t = world.getEntity(this.padlockId);
      if (!t || entityPosition(t).distanceTo(s.position) > PADLOCK_DROP_RANGE) this.padlockId = null;
    }
    if (this.targetId !== null && !world.getEntity(this.targetId)) this.targetId = null;
    if (this.mode === 'padlock' && this.padlockId === null) this.mode = 'cockpit';

    switch (this.mode) {
      case 'cockpit':
      case 'padlock': {
        let tYaw: number;
        let tPitch: number;
        this.padlockObstructed = false;
        if (input && (input.lookDelta.yaw !== 0 || input.lookDelta.pitch !== 0)) {
          this.freeYaw = MathUtils.clamp(this.freeYaw + input.lookDelta.yaw, -NECK_YAW_LIMIT, NECK_YAW_LIMIT);
          this.freePitch = MathUtils.clamp(this.freePitch + input.lookDelta.pitch, NECK_PITCH_MIN, NECK_PITCH_MAX);
          this.freeLookActive = true;
        }
        if (this.mode === 'padlock') {
          const t = world.getEntity(this.padlockId!)!;
          const a = headAnglesTo(player, entityPosition(t), eye);
          this.padlockObstructed = isObstructed(player, a.yaw, a.pitch);
          tYaw = a.yaw;
          tPitch = a.pitch;
        } else if (input?.snapLook) {
          tYaw = input.snapLook.yaw;
          tPitch = input.snapLook.pitch;
        } else if (this.freeLookActive) {
          tYaw = this.freeYaw;
          tPitch = this.freePitch;
        } else if (input?.aimDirection) {
          const target = input.aimDirection.clone().multiplyScalar(2000).add(s.position);
          const a = headAnglesTo(player, target, eye);
          tYaw = a.yaw * 0.9;
          tPitch = a.pitch * 0.9;
        } else {
          tYaw = 0;
          tPitch = 0;
        }
        tYaw = MathUtils.clamp(tYaw, -NECK_YAW_LIMIT, NECK_YAW_LIMIT);
        tPitch = MathUtils.clamp(tPitch, NECK_PITCH_MIN, NECK_PITCH_MAX);
        const rate = this.mode === 'padlock' || input?.snapLook ? 10 : 30;
        const k = 1 - Math.exp(-rate * dt);
        this.headYaw += (tYaw - this.headYaw) * k;
        this.headPitch += (tPitch - this.headPitch) * k;
        const head = new Quaternion().setFromEuler(new Euler(this.headPitch, this.headYaw, 0, 'YXZ'));
        cam.quaternion.copy(q).multiply(head);
        cam.position.copy(eye).applyQuaternion(q).add(s.position);
        this.applyShake(dt, player);
        break;
      }
      case 'chase': {
        if (!this.chaseInit) {
          this.chaseQuat.copy(q);
          this.chaseInit = true;
        }
        this.chaseQuat.slerp(q, 1 - Math.exp(-5 * dt));
        if (input?.aimDirection) {
          const back = input.aimDirection.clone().multiplyScalar(-16);
          cam.position.copy(s.position).add(back).add(new Vector3(0, 3.5, 0));
          cam.up.set(0, 1, 0);
          cam.lookAt(input.aimDirection.clone().multiplyScalar(200).add(s.position));
        } else {
          const off = new Vector3(0, 3.2, 15).applyQuaternion(this.chaseQuat);
          cam.position.copy(s.position).add(off);
          cam.up.set(0, 1, 0).applyQuaternion(this.chaseQuat);
          cam.lookAt(new Vector3(0, 0, -30).applyQuaternion(this.chaseQuat).add(s.position));
        }
        break;
      }
      case 'flyby': {
        const vel = s.velocity.lengthSq() > 1 ? s.velocity.clone().normalize() : new Vector3(0, 0, -1).applyQuaternion(q);
        if (!this.flybyPos || this.flybyPos.distanceTo(s.position) > 450) {
          const side = new Vector3().crossVectors(vel, new Vector3(0, 1, 0)).normalize();
          this.flybyPos = s.position.clone().addScaledVector(vel, 260).addScaledVector(side, 25).add(new Vector3(0, 6, 0));
          const gh = world.groundHeightAt(this.flybyPos.x, this.flybyPos.z) + 3;
          if (this.flybyPos.y < gh) this.flybyPos.y = gh;
        }
        cam.position.copy(this.flybyPos);
        cam.up.set(0, 1, 0);
        cam.lookAt(s.position);
        break;
      }
      case 'target': {
        const t = this.targetId !== null ? world.getEntity(this.targetId) : undefined;
        if (!t) {
          this.mode = 'chase';
          return this.update(dt, player, world, eye, input);
        }
        const tp = entityPosition(t);
        const dir = tp.clone().sub(s.position).normalize();
        cam.position.copy(s.position).addScaledVector(dir, -20).add(new Vector3(0, 4, 0));
        cam.up.set(0, 1, 0);
        cam.lookAt(tp);
        break;
      }
      case 'orbit': {
        if (input) {
          this.orbitYaw += input.lookDelta.yaw;
          this.orbitPitch = MathUtils.clamp(this.orbitPitch + input.lookDelta.pitch, -1.2, 1.4);
        }
        const off = new Vector3(
          Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch),
          Math.sin(this.orbitPitch),
          Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch),
        ).multiplyScalar(this.orbitDist);
        cam.position.copy(s.position).add(off);
        cam.up.set(0, 1, 0);
        cam.lookAt(s.position);
        break;
      }
    }
    // Never below ground.
    const gh = world.groundHeightAt(cam.position.x, cam.position.z) + 0.8;
    if (cam.position.y < gh && !this.inCockpit) cam.position.y = gh;
    cam.updateMatrixWorld(true);
  }

  private applyShake(dt: number, player: AircraftEntity): void {
    const g = Math.abs(player.state.gLoad);
    const amp = Math.max(0, g - 2.5) * 0.004 + (player.state.onGround ? player.state.airspeed * 0.0004 : 0);
    if (amp <= 0) return;
    this.shakeT += dt * 40;
    this.camera.position.x += Math.sin(this.shakeT * 1.3) * amp;
    this.camera.position.y += Math.sin(this.shakeT * 1.7 + 1) * amp;
  }
}
