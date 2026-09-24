/**
 * Input: keyboard (rebindable actions), mouse (direct stick or mouse-aim
 * "instructor"), gamepad (standard mapping). Produces an InputFrame per
 * render frame; the flight session copies `controls` into the player.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity, ControlInputs, ControlSettings } from '../core/types';

/** Edge-triggered actions (fire once per press). */
export const EDGE_ACTIONS = [
  'throttleFull',
  'throttleCut',
  'clearJam',
  'viewCockpit',
  'viewChase',
  'viewPadlock',
  'viewTarget',
  'viewFlyby',
  'nextTarget',
  'padlockNearest',
  'timeCompress',
  'timeNormal',
  'pause',
  'map',
  'endFlight',
  'wingmenMenu',
  'wingmenAttack',
  'wingmenEngage',
  'wingmenFormUp',
  'wingmenCover',
  'wingmenHome',
  'toggleHud',
] as const;
export type EdgeAction = (typeof EDGE_ACTIONS)[number];

export interface InputFrame {
  controls: ControlInputs;
  commands: EdgeAction[];
  /** Snap head direction from held look keys/hat (radians; yaw + = left, pitch + = up), or null. */
  snapLook: { yaw: number; pitch: number } | null;
  /** Free-look mouse/stick deltas this frame (radians). */
  lookDelta: { yaw: number; pitch: number };
  /** Mouse-aim target direction in world space (unit), when mouse-aim is active. */
  aimDirection: Vector3 | null;
  /** True if the player is actively overriding with keys/pad this frame. */
  manualOverride: boolean;
}

/** Map a set of held KeyboardEvent.codes to the set of actions they trigger. */
export function resolveHeldActions(held: ReadonlySet<string>, bindings: Record<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [action, codes] of Object.entries(bindings)) {
    if (codes.some((c) => held.has(c))) out.add(action);
  }
  return out;
}

/** Reverse lookup: which action(s) does a code trigger? */
export function actionsForCode(code: string, bindings: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const [action, codes] of Object.entries(bindings)) if (codes.includes(code)) out.push(action);
  return out;
}

export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

/** Exponential response curve: fine control near centre, full deflection at the stops. */
export function expo(v: number, k = 0.4): number {
  return (1 - k) * v + k * v * v * v;
}

/** Move `current` toward `target` at `rate` per second. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const d = target - current;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface MouseAimState {
  prevPitchErr: number;
  prevRollErr: number;
  prevYawErr: number;
}

export function createMouseAimState(): MouseAimState {
  return { prevPitchErr: 0, prevRollErr: 0, prevYawErr: 0 };
}

const _inv = new Quaternion();
const _local = new Vector3();
const _up = new Vector3();

/**
 * Mouse-aim instructor: fly the nose toward a world-space aim direction.
 * Banks toward the aim point and pulls (lift-vector steering), levels the
 * wings when the aim is nearly dead ahead, and uses a touch of rudder.
 * Uses error derivatives for damping, so it is independent of the sim's
 * angular-velocity sign conventions.
 */
export function mouseAimControls(
  ac: AircraftEntity,
  aim: Vector3,
  st: MouseAimState,
  dt: number,
  out: { pitch: number; roll: number; yaw: number },
): void {
  _inv.copy(ac.state.orientation).invert();
  _local.copy(aim).normalize().applyQuaternion(_inv);
  _up.set(0, 1, 0).applyQuaternion(_inv);
  const angle = Math.acos(clamp(-_local.z, -1, 1));
  const pitchErr = Math.atan2(_local.y, -_local.z);
  const yawErr = Math.atan2(_local.x, -_local.z);
  const levelErr = Math.atan2(_up.x, _up.y); // roll right (+) when banked left (world up leans to body +X)
  const aimRollErr = Math.atan2(_local.x, Math.abs(_local.y) + 0.05);
  const w = smoothstep(angle, 0.035, 0.2);
  const rollErr = levelErr * (1 - w) + aimRollErr * w;
  const inv = dt > 0 ? 1 / dt : 0;
  const dPitch = (pitchErr - st.prevPitchErr) * inv;
  const dRoll = (rollErr - st.prevRollErr) * inv;
  const dYaw = (yawErr - st.prevYawErr) * inv;
  st.prevPitchErr = pitchErr;
  st.prevRollErr = rollErr;
  st.prevYawErr = yawErr;
  // Only pull when the aim is roughly above the wings (after banking toward it).
  const pullGate = _local.y >= 0 ? 1 : 1 - w * 0.6;
  out.pitch = clamp((pitchErr * 4 + dPitch * 0.25) * pullGate, -1, 1);
  out.roll = clamp(rollErr * 2.2 + dRoll * 0.15, -1, 1);
  out.yaw = clamp(yawErr * 2.5 + dYaw * 0.1, -1, 1);
  // Ground safety: don't dive into the ground chasing a low aim point.
  if (ac.state.heightAboveGround < 120 && ac.state.velocity.y < 0) out.pitch = Math.max(out.pitch, 0.35);
}

const KEY_AXIS_RATE = 3.5; // per s toward full deflection
const KEY_AXIS_RETURN = 6;
const THROTTLE_RATE = 0.5;

/** Snap-look directions (radians): yaw + = left. */
export function snapLookFrom(actions: ReadonlySet<string>): { yaw: number; pitch: number } | null {
  const l = actions.has('lookLeft');
  const r = actions.has('lookRight');
  const b = actions.has('lookBack');
  const u = actions.has('lookUp');
  if (!l && !r && !b && !u) return null;
  let yaw = 0;
  if (b) yaw = l ? (Math.PI * 3) / 4 : r ? (-Math.PI * 3) / 4 : Math.PI;
  else if (l) yaw = Math.PI / 2;
  else if (r) yaw = -Math.PI / 2;
  const pitch = u ? (l || r || b ? Math.PI / 5 : Math.PI / 3) : 0;
  return { yaw, pitch };
}

export class InputManager {
  private held = new Set<string>();
  private pressedQueue: string[] = [];
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private mouseButtons = 0;
  private stickX = 0;
  private stickY = 0;
  private keyPitch = 0;
  private keyRoll = 0;
  private keyYaw = 0;
  private throttle = 0.85;
  private prevPadButtons: boolean[] = [];
  private aim: Vector3 | null = null;
  private aimState = createMouseAimState();
  private detachFns: (() => void)[] = [];
  enabled = true;

  constructor(
    private readonly element: HTMLElement,
    private readonly getControls: () => ControlSettings,
  ) {}

  attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code.startsWith('F') || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressedQueue.push(e.code);
      this.held.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.held.delete(e.code);
    const onBlur = () => {
      this.held.clear();
      this.mouseButtons = 0;
    };
    const onMouseMove = (e: MouseEvent) => {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    const onMouseDown = (e: MouseEvent) => {
      this.mouseButtons = e.buttons;
      const mode = this.getControls().mouseMode;
      if (mode !== 'off' && document.pointerLockElement !== this.element) {
        this.element.requestPointerLock?.()?.catch?.(() => {});
      }
    };
    const onMouseUp = (e: MouseEvent) => (this.mouseButtons = e.buttons);
    const onWheel = (e: WheelEvent) => {
      this.wheel += e.deltaY;
      e.preventDefault();
    };
    const onContext = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.element.addEventListener('mousemove', onMouseMove);
    this.element.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.element.addEventListener('wheel', onWheel, { passive: false });
    this.element.addEventListener('contextmenu', onContext);
    this.detachFns.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.element.removeEventListener('mousemove', onMouseMove),
      () => this.element.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.element.removeEventListener('wheel', onWheel),
      () => this.element.removeEventListener('contextmenu', onContext),
    );
  }

  detach(): void {
    this.detachFns.forEach((f) => f());
    this.detachFns = [];
    if (document.pointerLockElement === this.element) document.exitPointerLock?.();
  }

  setThrottle(t: number): void {
    this.throttle = clamp(t, 0, 1);
  }

  /** Reset mouse-aim to the aircraft's current heading (e.g. after a view change or spawn). */
  resetAim(ac: AircraftEntity): void {
    this.aim = new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation);
  }

  /**
   * Build this frame's input. `cameraMovesWithAim` should be true in views
   * where mouse movement steers (chase/cockpit); orbit/padlock use it for look.
   */
  update(dt: number, player: AircraftEntity | null, mouseSteers: boolean): InputFrame {
    const cs = this.getControls();
    const bindings = cs.keyBindings;
    const actions = resolveHeldActions(this.held, bindings);
    const commands: EdgeAction[] = [];
    for (const code of this.pressedQueue) {
      for (const a of actionsForCode(code, bindings)) if ((EDGE_ACTIONS as readonly string[]).includes(a)) commands.push(a as EdgeAction);
    }
    this.pressedQueue = [];

    // --- keyboard axes (smoothed)
    const kp = (actions.has('pitchUp') ? 1 : 0) - (actions.has('pitchDown') ? 1 : 0);
    const kr = (actions.has('rollRight') ? 1 : 0) - (actions.has('rollLeft') ? 1 : 0);
    const ky = (actions.has('yawRight') ? 1 : 0) - (actions.has('yawLeft') ? 1 : 0);
    this.keyPitch = approach(this.keyPitch, kp, kp === 0 ? KEY_AXIS_RETURN : KEY_AXIS_RATE, dt);
    this.keyRoll = approach(this.keyRoll, kr, kr === 0 ? KEY_AXIS_RETURN : KEY_AXIS_RATE, dt);
    this.keyYaw = approach(this.keyYaw, ky, ky === 0 ? KEY_AXIS_RETURN : KEY_AXIS_RATE, dt);

    if (actions.has('throttleUp')) this.throttle += THROTTLE_RATE * dt;
    if (actions.has('throttleDown')) this.throttle -= THROTTLE_RATE * dt;
    if (commands.includes('throttleFull')) this.throttle = 1;
    if (commands.includes('throttleCut')) this.throttle = 0;
    if (this.wheel !== 0) {
      this.throttle -= this.wheel * 0.0008;
      this.wheel = 0;
    }

    let fire = actions.has('fire');
    let blip = actions.has('blip');
    let clearJam = commands.includes('clearJam');
    let padPitch = 0;
    let padRoll = 0;
    let padYaw = 0;
    const lookDelta = { yaw: 0, pitch: 0 };
    const snapLook = snapLookFrom(actions);

    // --- gamepad
    if (cs.gamepadEnabled && typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pad = [...navigator.getGamepads()].find((p) => p && p.connected);
      if (pad) {
        const dz = cs.gamepadDeadzone;
        padRoll = expo(applyDeadzone(pad.axes[0] ?? 0, dz));
        padPitch = expo(applyDeadzone(pad.axes[1] ?? 0, dz)) * (cs.invertPitch ? -1 : 1);
        const lx = applyDeadzone(pad.axes[2] ?? 0, dz);
        const ly = applyDeadzone(pad.axes[3] ?? 0, dz);
        lookDelta.yaw -= lx * 2.5 * dt;
        lookDelta.pitch -= ly * 2.0 * dt;
        const b = (i: number) => !!pad.buttons[i]?.pressed;
        const edge = (i: number) => b(i) && !this.prevPadButtons[i];
        if (b(4)) padYaw -= 1;
        if (b(5)) padYaw += 1;
        if (b(7) || (pad.buttons[7]?.value ?? 0) > 0.4) fire = true;
        if (b(6) || (pad.buttons[6]?.value ?? 0) > 0.4) blip = true;
        if (b(12)) this.throttle += THROTTLE_RATE * dt;
        if (b(13)) this.throttle -= THROTTLE_RATE * dt;
        if (edge(0)) clearJam = true;
        if (edge(2)) commands.push('nextTarget');
        if (edge(3)) commands.push('viewPadlock');
        if (edge(11)) commands.push('padlockNearest');
        if (edge(1)) commands.push('viewChase');
        if (edge(10)) commands.push('viewCockpit');
        if (edge(8)) commands.push('map');
        if (edge(9)) commands.push('pause');
        if (edge(14) || edge(15)) commands.push(edge(14) ? 'timeNormal' : 'timeCompress');
        this.prevPadButtons = pad.buttons.map((x) => x.pressed);
      }
    }
    this.throttle = clamp(this.throttle, 0, 1);

    // --- mouse
    const sens = cs.mouseSensitivity;
    const mdx = this.mouseDX;
    const mdy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    let aimDirection: Vector3 | null = null;
    let mousePitch = 0;
    let mouseRoll = 0;
    let mouseYaw = 0;
    const leftDown = (this.mouseButtons & 1) !== 0;
    const rightDown = (this.mouseButtons & 2) !== 0;
    if (cs.mouseMode === 'mouse-aim' && player) {
      if (!this.aim) this.resetAim(player);
      if (mouseSteers && !rightDown) {
        // Rotate the aim direction: yaw about world up, pitch about the aim's right axis.
        const yawA = -mdx * 0.0022 * sens;
        const pitchA = -mdy * 0.0022 * sens * (cs.invertPitch ? -1 : 1);
        const aim = this.aim!;
        aim.applyAxisAngle(new Vector3(0, 1, 0), yawA);
        const right = new Vector3().crossVectors(aim, new Vector3(0, 1, 0)).normalize();
        const next = aim.clone().applyAxisAngle(right, pitchA);
        if (Math.abs(next.y) < 0.97) aim.copy(next);
        aim.normalize();
      } else {
        lookDelta.yaw -= mdx * 0.003 * sens;
        lookDelta.pitch -= mdy * 0.003 * sens;
      }
      aimDirection = this.aim!.clone();
      const out = { pitch: 0, roll: 0, yaw: 0 };
      mouseAimControls(player, this.aim!, this.aimState, dt, out);
      mousePitch = out.pitch;
      mouseRoll = out.roll;
      mouseYaw = out.yaw;
      if (leftDown) fire = true;
    } else if (cs.mouseMode === 'direct-stick') {
      if (rightDown || !mouseSteers) {
        lookDelta.yaw -= mdx * 0.003 * sens;
        lookDelta.pitch -= mdy * 0.003 * sens;
      } else {
        this.stickX = clamp(this.stickX + mdx * 0.004 * sens, -1, 1);
        this.stickY = clamp(this.stickY + mdy * 0.004 * sens * (cs.invertPitch ? -1 : 1), -1, 1);
      }
      mouseRoll = this.stickX;
      mousePitch = this.stickY; // mouse pulled back (down, +dy) = stick back = nose up
      if (leftDown) fire = true;
    } else {
      // mouse off: drag to look around
      if (leftDown || rightDown) {
        lookDelta.yaw -= mdx * 0.004 * sens;
        lookDelta.pitch -= mdy * 0.004 * sens;
      }
    }

    const keyActive = Math.abs(this.keyPitch) + Math.abs(this.keyRoll) + Math.abs(this.keyYaw) > 0.01;
    const padActive = Math.abs(padPitch) + Math.abs(padRoll) + Math.abs(padYaw) > 0.01;
    const manualOverride = keyActive || padActive;
    const invertKeys = cs.invertPitch ? -1 : 1;
    let pitch: number, roll: number, yaw: number;
    if (cs.mouseMode === 'mouse-aim' && manualOverride) {
      pitch = this.keyPitch * invertKeys + padPitch;
      roll = this.keyRoll + padRoll;
      yaw = this.keyYaw + padYaw;
      if (player) this.resetAim(player); // re-sync aim with the nose after manual flying
    } else {
      pitch = this.keyPitch * invertKeys + padPitch + mousePitch;
      roll = this.keyRoll + padRoll + mouseRoll;
      yaw = this.keyYaw + padYaw + mouseYaw;
    }

    return {
      controls: {
        pitch: clamp(pitch, -1, 1),
        roll: clamp(roll, -1, 1),
        yaw: clamp(yaw, -1, 1),
        throttle: this.throttle,
        blip,
        fireGuns: fire,
        clearJam,
      },
      commands,
      snapLook,
      lookDelta,
      aimDirection,
      manualOverride,
    };
  }
}
