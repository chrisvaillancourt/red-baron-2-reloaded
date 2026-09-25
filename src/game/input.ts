/**
 * Input: keyboard (rebindable actions), mouse (direct stick or mouse-aim
 * "instructor"), gamepad (standard mapping). Produces an InputFrame per
 * render frame; the flight session copies `controls` into the player.
 */
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, ControlInputs, ControlSettings, FlightModelLevel } from '../core/types';
import { Autopilot } from '../ai/autopilot';
import { traitsFor } from '../ai/traits';
import { getCoefficients } from '../sim/coefficients';

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
  /** Model-inverse autopilot (src/ai) used by the instructor when a WorldQuery is available. */
  pilot: Autopilot | null;
  pilotKey: string;
}

export function createMouseAimState(): MouseAimState {
  return { prevPitchErr: 0, prevRollErr: 0, prevYawErr: 0, pilot: null, pilotKey: '' };
}

/**
 * Instructor limits per flight-model level: relaxed is gentle and safe, authentic lets you
 * pull hard. `caution` is the structural/dive margin (0 careless .. 1 wide); `stallMarginDeg`
 * is the AoA kept below the stall, separate from it so the beginner level gets the widest
 * margin on both (it used to derive the stall margin from caution, which gave relaxed the
 * narrowest, an ace's 1.0 deg).
 */
export const INSTRUCTOR: Record<FlightModelLevel, { maxG: number; caution: number; stallMarginDeg: number; maxPerformance: boolean; minAgl: number }> = {
  relaxed: { maxG: 5, caution: 1, stallMarginDeg: 3.2, maxPerformance: true, minAgl: 90 },
  standard: { maxG: 5.2, caution: 0.85, stallMarginDeg: 1.8, maxPerformance: true, minAgl: 60 },
  authentic: { maxG: 6.2, caution: 0.6, stallMarginDeg: 1.3, maxPerformance: true, minAgl: 35 },
};

/**
 * Mouse-aim instructor on the real flight model: the AI's model-inverse
 * autopilot points the gun line at the aim direction. It knows each type's
 * stall AoA, g limit, Vne, rotary torque and the terrain, so the player can
 * fight hard without departing. Only stick and rudder are taken; throttle
 * and blip stay with the player.
 */
export function mouseAimAssist(
  ac: AircraftEntity,
  aim: Vector3,
  st: MouseAimState,
  world: WorldQuery,
  level: FlightModelLevel,
  dt: number,
  out: { pitch: number; roll: number; yaw: number },
): void {
  const key = `${ac.id}:${ac.spec.id}:${level}`;
  const cfg = INSTRUCTOR[level];
  if (!st.pilot || st.pilotKey !== key) {
    const p = ac.spec.performance;
    st.pilot = new Autopilot(traitsFor(ac.spec), cfg.maxG, cfg.minAgl, p.rollRate, p.pitchRate, getCoefficients(ac.spec));
    st.pilot.diveCaution = cfg.caution;
    st.pilot.stallMarginDeg = cfg.stallMarginDeg;
    st.pilotKey = key;
  }
  const c = ac.controls;
  const s = ac.state;
  if (s.onGround || (s.heightAboveGround < 4 && s.airspeed < traitsFor(ac.spec).stallSpeed * 1.3)) {
    groundHandling(ac, aim, out);
    return;
  }
  // Throttled back near the ground = landing: let the aim point take the aircraft down
  // (the instructor otherwise defends its terrain margin) and keep the pull gentle.
  const landing = c.throttle < 0.3 && s.heightAboveGround < 150;
  const saved = { pitch: c.pitch, roll: c.roll, yaw: c.yaw, throttle: c.throttle, blip: c.blip };
  st.pilot.fly(
    ac,
    landing
      ? { dir: aim, speed: Infinity, aim: false, maxG: 2, minAgl: 6, lowLevel: true, landing: true }
      : { dir: aim, speed: Infinity, aim: true, maxPerformance: cfg.maxPerformance, minAgl: cfg.minAgl },
    world,
    Math.max(dt, 1e-3),
  );
  out.pitch = c.pitch;
  out.roll = c.roll;
  out.yaw = c.yaw;
  c.pitch = saved.pitch;
  c.roll = saved.roll;
  c.yaw = saved.yaw;
  c.throttle = saved.throttle;
  c.blip = saved.blip;
}

/** Minimal slice of the Gamepad API the mapping reads (lets tests pass a virtual pad). */
export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadFrame {
  roll: number;
  pitch: number;
  yaw: number;
  lookYaw: number;
  lookPitch: number;
  fire: boolean;
  blip: boolean;
  clearJam: boolean;
  throttleDelta: number;
  commands: EdgeAction[];
  /** Button states to pass back as `prev` next frame (edge detection). */
  pressed: boolean[];
}

/**
 * Standard-mapping gamepad → flight controls. Left stick flies (back = nose
 * up), right stick looks, bumpers are rudder, RT fires, LT is the blip
 * switch, D-pad up/down is throttle, A hammers a jammed gun, X/Y/R3 cycle
 * target / padlock / padlock nearest, B/L3 chase/cockpit view, Back = map,
 * Start = pause, D-pad left/right = time compression off/on. Keep the
 * Flying School card (src/ui/flyingSchool.ts) in step with this table.
 */
export function readGamepad(pad: PadLike, prev: readonly boolean[], cs: ControlSettings, dt: number): PadFrame {
  const dz = cs.gamepadDeadzone;
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  const edge = (i: number) => b(i) && !prev[i];
  const lx = applyDeadzone(pad.axes[2] ?? 0, dz);
  const ly = applyDeadzone(pad.axes[3] ?? 0, dz);
  const commands: EdgeAction[] = [];
  if (edge(2)) commands.push('nextTarget');
  if (edge(3)) commands.push('viewPadlock');
  if (edge(11)) commands.push('padlockNearest');
  if (edge(1)) commands.push('viewChase');
  if (edge(10)) commands.push('viewCockpit');
  if (edge(8)) commands.push('map');
  if (edge(9)) commands.push('pause');
  if (edge(14)) commands.push('timeNormal');
  if (edge(15)) commands.push('timeCompress');
  return {
    roll: expo(applyDeadzone(pad.axes[0] ?? 0, dz)),
    pitch: expo(applyDeadzone(pad.axes[1] ?? 0, dz)) * (cs.invertPitch ? -1 : 1),
    yaw: (b(5) ? 1 : 0) - (b(4) ? 1 : 0),
    lookYaw: -lx * 2.5 * dt,
    lookPitch: -ly * 2.0 * dt,
    fire: b(7) || (pad.buttons[7]?.value ?? 0) > 0.4,
    blip: b(6) || (pad.buttons[6]?.value ?? 0) > 0.4,
    clearJam: edge(0),
    throttleDelta: ((b(12) ? 1 : 0) - (b(13) ? 1 : 0)) * THROTTLE_RATE * dt,
    commands,
    pressed: pad.buttons.map((x) => x.pressed),
  };
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

/**
 * Mouse-aim on the ground: the mouse steers (rudder toward the aim heading),
 * wings are held level, and the stick follows the tail-dragger routine —
 * tail up to accelerate, rotate once there is flying speed and the aim is
 * raised, stick back to keep the tail down when rolling out slowly.
 */
function groundHandling(ac: AircraftEntity, aim: Vector3, out: { pitch: number; roll: number; yaw: number }): void {
  const s = ac.state;
  const q = s.orientation;
  const f = _gf.set(0, 0, -1).applyQuaternion(q);
  const r = _gr.set(1, 0, 0).applyQuaternion(q);
  const u = _gu.set(0, 1, 0).applyQuaternion(q);
  const vs = traitsFor(ac.spec).stallSpeed;
  const bank = Math.atan2(-r.y, u.y);
  const hdg = Math.atan2(f.x, -f.z);
  const aimHdg = Math.atan2(aim.x, -aim.z);
  let hErr = aimHdg - hdg;
  hErr = Math.atan2(Math.sin(hErr), Math.cos(hErr));
  const aimElev = Math.asin(clamp(aim.y, -1, 1));
  const pitchAng = Math.asin(clamp(f.y, -1, 1));
  out.roll = clamp(-bank * 2 + s.angularVelocity.z * 0.4, -1, 1);
  out.yaw = clamp(hErr * 3 + s.angularVelocity.y * 0.8, -1, 1);
  if (s.airspeed < vs * 0.6 && ac.controls.throttle < 0.5) out.pitch = 0.35; // taxi / rollout: tail down
  else if (s.airspeed > vs * 1.15 && aimElev > 0.04) out.pitch = clamp(0.25 + aimElev, 0.25, 0.5); // rotate
  else out.pitch = clamp((0.02 - pitchAng) * 5 - s.angularVelocity.x, -1, 1); // tail up, accelerate
}
const _gf = new Vector3();
const _gr = new Vector3();
const _gu = new Vector3();

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
    /** Live world + realism for the model-aware mouse-aim instructor (legacy law without them). */
    private readonly getWorld: () => WorldQuery | null = () => null,
    private readonly getLevel: () => FlightModelLevel = () => 'standard',
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
        const g = readGamepad(pad, this.prevPadButtons, cs, dt);
        padRoll = g.roll;
        padPitch = g.pitch;
        padYaw = g.yaw;
        lookDelta.yaw += g.lookYaw;
        lookDelta.pitch += g.lookPitch;
        fire ||= g.fire;
        blip ||= g.blip;
        clearJam ||= g.clearJam;
        this.throttle += g.throttleDelta;
        commands.push(...g.commands);
        this.prevPadButtons = g.pressed;
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
      const world = this.getWorld();
      if (world) mouseAimAssist(player, this.aim!, this.aimState, world, this.getLevel(), dt, out);
      else mouseAimControls(player, this.aim!, this.aimState, dt, out);
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
