/**
 * Input: keyboard (rebindable actions), mouse (direct stick or mouse-aim
 * "instructor"), gamepad (standard mapping), and normalized touch intent.
 * Produces an InputFrame per render frame; the session copies `controls` into the player.
 */
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, ControlInputs, ControlSettings, FlightModelLevel } from '../core/types';
import { Autopilot } from '../ai/autopilot';
import { traitsFor } from '../ai/traits';
import { getCoefficients } from '../sim/coefficients';
import type { TouchInputState } from './touchInput';

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
  'stationNext',
  'stationPrev',
  'stationPilot',
  'releaseBomb',
  'viewBombsight',
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
  /** True when keys/pad override the instructor, or touch owns the pilot's controls (even centred). */
  manualOverride: boolean;
  /**
   * At a gunner's station (`InputManager.stationMode`): how far to swing the gun this frame,
   * radians, azimuth + = right, elevation + = up. The flight controls are the AI pilot's then.
   */
  stationAim?: { azimuth: number; elevation: number };
}

/** Degrees per second a gun swings at full key or stick deflection. */
export const STATION_KEY_AIM_RATE_DEG = 60;
/** Radians per mouse pixel at sensitivity 1 (the mouse-aim instructor's scale). */
const MOUSE_AIM_RAD_PER_PX = 0.0022;

/**
 * A gunner's aim swing for one frame from the mouse (pixels; moved right and up swings right
 * and up), the keys and the stick (-1..1 each: right and up positive).
 */
export function stationAimDelta(
  i: { mouseDX: number; mouseDY: number; keyAz: number; keyEl: number; padAz: number; padEl: number },
  cs: Pick<ControlSettings, 'mouseSensitivity' | 'invertPitch'>,
  dt: number,
): { azimuth: number; elevation: number } {
  const inv = cs.invertPitch ? -1 : 1;
  const rate = (STATION_KEY_AIM_RATE_DEG * Math.PI) / 180;
  return {
    azimuth: i.mouseDX * MOUSE_AIM_RAD_PER_PX * cs.mouseSensitivity + (i.keyAz + i.padAz) * rate * dt,
    elevation: (-i.mouseDY * MOUSE_AIM_RAD_PER_PX * cs.mouseSensitivity + (i.keyEl + i.padEl) * rate * dt) * inv,
  };
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
  /** Held X in bombsight context; the sim consumes its rising edge. */
  releaseBomb: boolean;
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
export function readGamepad(
  pad: PadLike, prev: readonly boolean[], cs: ControlSettings, dt: number,
  context: { stationMode?: boolean; bombsightMode?: boolean; mapMode?: boolean } = {},
  out: PadFrame = createPadFrame(),
): PadFrame {
  const dz = cs.gamepadDeadzone;
  let edges = 0;
  for (let i = 0; i < pad.buttons.length; i++) {
    const held = pad.buttons[i].pressed || pad.buttons[i].value > 0.4;
    if (i < 32 && held && !prev[i]) edges |= 1 << i;
    out.pressed[i] = held;
  }
  out.pressed.length = pad.buttons.length;
  const pressed = out.pressed;
  const commands = out.commands;
  commands.length = 0;
  if (edges & (1 << 2)) commands.push(context.bombsightMode ? 'releaseBomb' : 'nextTarget');
  if (edges & (1 << 3)) commands.push('viewPadlock');
  if (edges & (1 << 11)) commands.push('padlockNearest');
  // Over a map that does not capture flight input, B closes it and does nothing else.
  if (edges & (1 << 1)) commands.push(context.mapMode ? 'map' : context.stationMode ? 'stationPilot' : 'viewChase');
  // A fresh crew B returns control to the pilot, overriding this frame's seat cycling.
  if (context.stationMode && !(edges & (1 << 1))) {
    if (edges & (1 << 4)) commands.push('stationPrev');
    if (edges & (1 << 5)) commands.push('stationNext');
  }
  if (edges & (1 << 10)) commands.push('viewCockpit');
  if (edges & (1 << 8)) commands.push('map');
  if (edges & (1 << 9)) commands.push('pause');
  if (edges & (1 << 14)) commands.push('timeNormal');
  if (edges & (1 << 15)) commands.push('timeCompress');
  out.roll = expo(applyDeadzone(pad.axes[0] ?? 0, dz));
  out.pitch = expo(applyDeadzone(pad.axes[1] ?? 0, dz)) * (cs.invertPitch ? -1 : 1);
  out.yaw = context.stationMode ? 0 : Number(!!pressed[5]) - Number(!!pressed[4]);
  out.lookYaw = -applyDeadzone(pad.axes[2] ?? 0, dz) * 2.5 * dt;
  out.lookPitch = -applyDeadzone(pad.axes[3] ?? 0, dz) * 2.0 * dt;
  out.fire = !!pressed[7];
  out.blip = !!pressed[6];
  out.releaseBomb = !!context.bombsightMode && !!pressed[2];
  out.clearJam = !!(edges & 1);
  out.throttleDelta = (Number(!!pressed[12]) - Number(!!pressed[13])) * THROTTLE_RATE * dt;
  return out;
}

function createPadFrame(): PadFrame {
  return {
    roll: 0, pitch: 0, yaw: 0, lookYaw: 0, lookPitch: 0, fire: false, blip: false,
    releaseBomb: false, clearJam: false, throttleDelta: 0, commands: [], pressed: [],
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
// Same full-deflection camera rates as the gamepad, in radians per second.
const TOUCH_LOOK_YAW_RATE = 2.5;
const TOUCH_LOOK_PITCH_RATE = 2.0;

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

/** Standard-mapping X: target cycle, or bomb release in bombsight view. */
const PAD_X = 2;

export class InputManager {
  private held = new Set<string>();
  private pressedQueue: string[] = [];
  private commandQueue: EdgeAction[] = [];
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
  private readonly padFrame = createPadFrame();
  private _gamepadOwner: Readonly<{ index: number; id: string }> | null = null;
  private padArmed = false;
  private padLoss = false;
  private lastGamepadEnabled: boolean | null = null;
  private aim: Vector3 | null = null;
  private aimState = createMouseAimState();
  private detachFns: (() => void)[] = [];
  private lastMouseMode: ControlSettings['mouseMode'] | null = null;
  private _enabled = true;
  private _touchActive = false;
  private touch: TouchInputState = { stickX: 0, stickY: 0, rudder: 0, lookX: 0, lookY: 0, fire: false, blip: false };

  get enabled(): boolean { return this._enabled; }
  set enabled(value: boolean) {
    if (this._enabled === value) return;
    this._enabled = value;
    this.cancelTransientInput();
  }

  get touchActive(): boolean { return this._touchActive; }
  set touchActive(value: boolean) {
    if (this._touchActive === value) return;
    this._touchActive = value;
    this.cancelTransientInput();
  }
  /**
   * The player works a gun, not the controls: the mouse, the flight keys and the left stick
   * swing the gun (`InputFrame.stationAim`), the left button and fire key fire it, and the
   * right button drags the view. Flight controls come from the AI pilot meanwhile.
   */
  private _stationMode = false;
  get stationMode(): boolean { return this._stationMode; }
  set stationMode(value: boolean) {
    if (this._stationMode === value) return;
    this._stationMode = value;
    this.cancelTransientInput();
  }

  /**
   * Camera context is independent of whether the player occupies a gunner seat. It only
   * changes what X means, so a change disturbs nothing else: an X held across it waits for
   * release (no bomb, no target cycle), while keys, mouse, aim, sticks and triggers carry on.
   */
  private _bombsightMode = false;
  private xLatched = false;
  get bombsightMode(): boolean { return this._bombsightMode; }
  set bombsightMode(value: boolean) {
    if (this._bombsightMode === value) return;
    this._bombsightMode = value;
    if (this.padFrame.pressed[PAD_X]) this.xLatched = true;
  }

  private _padUsed = false;
  /** The owning pad has produced input since it armed (held launch controls don't count). */
  get padUsed(): boolean { return this._padUsed; }

  /** The map is open without capturing flight input: B closes it (readGamepad context). */
  mapMode = false;

  get gamepadOwner(): Readonly<{ index: number; id: string }> | null { return this._gamepadOwner; }

  /** Current pinned standard pad, for a session-scoped menu (never another pad). */
  getGamepad(): Gamepad | null {
    if (!this._gamepadOwner || typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (pad?.connected && pad.mapping === 'standard' &&
          pad.index === this._gamepadOwner.index && pad.id === this._gamepadOwner.id) return pad;
    }
    return null;
  }

  /** Input reports loss; flight pause policy belongs to the session. */
  consumeGamepadLoss(): boolean {
    const lost = this.padLoss;
    this.padLoss = false;
    return lost;
  }

  private snapshotPad(pad: PadLike): void {
    const pressed = this.padFrame.pressed;
    pressed.length = pad.buttons.length;
    for (let i = 0; i < pad.buttons.length; i++) {
      pressed[i] = pad.buttons[i].pressed || pad.buttons[i].value > 0.4;
    }
  }

  private adoptPad(pad: Gamepad): void {
    this._gamepadOwner = Object.freeze({ index: pad.index, id: pad.id });
    this.padArmed = false;
    this.snapshotPad(pad);
  }

  private losePad(): void {
    if (this._gamepadOwner) this.padLoss = true;
    this._gamepadOwner = null;
    this._padUsed = false;
    this.padArmed = false;
    this.padFrame.pressed.length = 0;
  }

  constructor(
    private readonly element: HTMLElement,
    private readonly getControls: () => ControlSettings,
    /** Live world + realism for the model-aware mouse-aim instructor (legacy law without them). */
    private readonly getWorld: () => WorldQuery | null = () => null,
    private readonly getLevel: () => FlightModelLevel = () => 'standard',
    /**
     * The standard pad that owned menu navigation at launch. The flight inherits it as
     * owner (instead of the first standard pad) and disarms it: controls held through the
     * launch stay neutral until released.
     */
    initialPad: Gamepad | null = null,
  ) {
    if (initialPad?.connected && initialPad.mapping === 'standard') this.adoptPad(initialPad);
  }

  attach(): void {
    if (this.detachFns.length) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Cancellation is not a physical key-up: repeats cannot revive discarded holds.
      if (!this.enabled || (e.repeat && !this.held.has(e.code))) return;
      if (e.code === 'Tab' || e.code.startsWith('F') || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressedQueue.push(e.code);
      this.held.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.held.delete(e.code);
    const onBlur = () => this.cancelTransientInput();
    const onHidden = () => { if (document.hidden) this.cancelTransientInput(); };
    const onPadConnected = (e: GamepadEvent) => {
      const pad = e.gamepad;
      if (!this.getControls().gamepadEnabled || pad.mapping !== 'standard' || !pad.connected) return;
      if (!this._gamepadOwner) this.adoptPad(pad);
      else if (pad.index === this._gamepadOwner.index && pad.id === this._gamepadOwner.id) {
        this.padArmed = false;
        this.snapshotPad(pad);
      }
    };
    const onPadDisconnected = (e: GamepadEvent) => {
      const owner = this._gamepadOwner;
      if (owner && e.gamepad.index === owner.index && e.gamepad.id === owner.id) this.losePad();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || this.touchActive) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled || this.touchActive) return;
      this.mouseButtons = e.buttons;
      const mode = this.getControls().mouseMode;
      if (mode !== 'off' && document.pointerLockElement !== this.element) {
        this.element.requestPointerLock?.()?.catch?.(() => {});
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!this.enabled || this.touchActive) return;
      this.mouseButtons = e.buttons;
    };
    const onWheel = (e: WheelEvent) => {
      if (!this.enabled || this.touchActive) return;
      this.wheel += e.deltaY;
      e.preventDefault();
    };
    const onContext = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('gamepadconnected', onPadConnected);
    window.addEventListener('gamepaddisconnected', onPadDisconnected);
    this.element.addEventListener('mousemove', onMouseMove);
    this.element.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.element.addEventListener('wheel', onWheel, { passive: false });
    this.element.addEventListener('contextmenu', onContext);
    this.detachFns.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('visibilitychange', onHidden),
      () => window.removeEventListener('gamepadconnected', onPadConnected),
      () => window.removeEventListener('gamepaddisconnected', onPadDisconnected),
      () => this.element.removeEventListener('mousemove', onMouseMove),
      () => this.element.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.element.removeEventListener('wheel', onWheel),
      () => this.element.removeEventListener('contextmenu', onContext),
    );
  }

  detach(): void {
    this.cancelTransientInput();
    this.detachFns.forEach((f) => f());
    this.detachFns = [];
    this._gamepadOwner = null;
    this._padUsed = false;
    this.padArmed = false;
    this.padFrame.pressed.length = 0;
    if (typeof document !== 'undefined' && document.pointerLockElement === this.element) document.exitPointerLock?.();
  }

  setThrottle(t: number): void {
    this.throttle = clamp(t, 0, 1);
  }

  get throttleValue(): number { return this.throttle; }

  /** The UI supplies normalized intent, never synthetic keyboard/mouse events. */
  setTouchState(change: Partial<TouchInputState>): void {
    if (!this.enabled || !this.touchActive) return;
    Object.assign(this.touch, change);
  }

  /** An on-screen action follows the same edge path as a fresh keyboard press. */
  queueCommand(action: EdgeAction): void {
    if (this.enabled) this.commandQueue.push(action);
  }

  /** Neutralize interrupted gestures and held inputs without changing the authoritative throttle. */
  cancelTransientInput(): void {
    this.held.clear();
    this.pressedQueue.length = 0;
    this.commandQueue.length = 0;
    this.mouseDX = this.mouseDY = this.wheel = this.mouseButtons = 0;
    this.stickX = this.stickY = this.keyPitch = this.keyRoll = this.keyYaw = 0;
    this.touch.stickX = this.touch.stickY = this.touch.rudder = this.touch.lookX = this.touch.lookY = 0;
    this.touch.fire = this.touch.blip = false;
    this.padArmed = false;
    this.xLatched = false;
    const pad = this.getGamepad();
    if (pad) this.snapshotPad(pad);
    this.aim = null;
    this.aimState.prevPitchErr = this.aimState.prevRollErr = this.aimState.prevYawErr = 0;
    this.aimState.pilot = null;
    this.aimState.pilotKey = '';
  }

  private pollGamepad(cs: ControlSettings, dt: number): PadFrame | null {
    if (this.lastGamepadEnabled !== null && this.lastGamepadEnabled !== cs.gamepadEnabled) {
      this.padArmed = false;
      const current = this.getGamepad();
      if (current) this.snapshotPad(current);
    }
    this.lastGamepadEnabled = cs.gamepadEnabled;
    if (!cs.gamepadEnabled || typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    let pad = this.getGamepad();
    if (!pad && this._gamepadOwner) this.losePad();
    if (!pad) {
      for (const candidate of navigator.getGamepads()) {
        if (candidate?.connected && candidate.mapping === 'standard') {
          pad = candidate;
          this.adoptPad(pad);
          break;
        }
      }
    }
    if (!pad) return null;
    // The mapper reads each history slot before overwriting it, so reuse its pressed storage.
    const frame = readGamepad(pad, this.padFrame.pressed, cs, dt, this, this.padFrame);
    if (this.xLatched) {
      // Held across a bombsight change: the history already blocks its edge.
      if (frame.pressed[PAD_X]) frame.releaseBomb = false;
      else this.xLatched = false;
    }
    if (this.padArmed && !this._padUsed) {
      for (const held of frame.pressed) if (held) this._padUsed = true;
      for (let i = 0; i < 4; i++) if (Math.abs(pad.axes[i] ?? 0) > cs.gamepadDeadzone) this._padUsed = true;
    }
    if (!this.padArmed) {
      let neutral = true;
      for (const held of frame.pressed) if (held) neutral = false;
      for (let i = 0; i < 4; i++) if (Math.abs(pad.axes[i] ?? 0) > cs.gamepadDeadzone) neutral = false;
      if (neutral && this.enabled) this.padArmed = true;
      frame.roll = frame.pitch = frame.yaw = frame.lookYaw = frame.lookPitch = frame.throttleDelta = 0;
      frame.fire = frame.blip = frame.clearJam = frame.releaseBomb = false;
      // Menu and map-close remain available on a genuinely new press during disarm.
      let count = 0;
      for (const command of frame.commands) {
        if (command === 'pause' || command === 'map') frame.commands[count++] = command;
      }
      frame.commands.length = count;
    }
    return frame;
  }

  /** Reset mouse-aim to the aircraft's current heading (e.g. after a view change or spawn). */
  resetAim(ac: AircraftEntity): void {
    this.aim = new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation);
  }

  /**
   * Take over from the AI pilot without a jolt: the throttle and the mouse stick where the AI
   * left them, key axes centred, the mouse-aim point on the nose and its instructor fresh.
   */
  syncTo(ac: AircraftEntity): void {
    this.cancelTransientInput();
    this.throttle = clamp(ac.controls.throttle, 0, 1);
    this.stickX = clamp(ac.controls.roll, -1, 1);
    this.stickY = clamp(ac.controls.pitch, -1, 1);
    this.resetAim(ac);
  }

  /**
   * Build this frame's input. `cameraMovesWithAim` should be true in views
   * where mouse movement steers (chase/cockpit); orbit/padlock use it for look.
   */
  update(dt: number, player: AircraftEntity | null, mouseSteers: boolean): InputFrame {
    const cs = this.getControls();
    if (this.lastMouseMode !== null && this.lastMouseMode !== cs.mouseMode) this.cancelTransientInput();
    this.lastMouseMode = cs.mouseMode;
    if (!this.enabled) {
      // Keep navigation edges while discarding flight intent. The session decides
      // whether the current overlay allows pause or map-close.
      const pad = this.pollGamepad(cs, 0);
      return {
        controls: { pitch: 0, roll: 0, yaw: 0, throttle: this.throttle, blip: false, fireGuns: false, clearJam: false, releaseBomb: false },
        commands: pad?.commands.filter((command) => command === 'pause' || command === 'map') ?? [],
        snapLook: null,
        lookDelta: { yaw: 0, pitch: 0 },
        aimDirection: null,
        manualOverride: false,
      };
    }
    const bindings = cs.keyBindings;
    const actions = resolveHeldActions(this.held, bindings);
    const commands = this.commandQueue.splice(0);
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

    let fire = actions.has('fire') || (this.touchActive && this.touch.fire);
    let blip = actions.has('blip') || (this.touchActive && this.touch.blip);
    let clearJam = commands.includes('clearJam');
    let padPitch = 0;
    let padRoll = 0;
    let padYaw = 0;
    const lookDelta = { yaw: 0, pitch: 0 };
    const snapLook = snapLookFrom(actions);

    // --- gamepad
    const g = this.pollGamepad(cs, dt);
    if (g) {
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
    }
    this.throttle = clamp(this.throttle, 0, 1);

    // Screen down pulls the pilot's stick back; at a gun it lowers the aim.
    // Shape with the same deadzone/response as the pad, applying pitch inversion only at use.
    const touchRoll = this.touchActive ? expo(applyDeadzone(clamp(this.touch.stickX, -1, 1), cs.gamepadDeadzone)) : 0;
    const touchPitch = this.touchActive ? expo(applyDeadzone(clamp(this.touch.stickY, -1, 1), cs.gamepadDeadzone)) : 0;
    const touchYaw = this.touchActive ? applyDeadzone(clamp(this.touch.rudder, -1, 1), cs.gamepadDeadzone) : 0;
    if (this.touchActive) {
      lookDelta.yaw -= applyDeadzone(clamp(this.touch.lookX, -1, 1), cs.gamepadDeadzone) * TOUCH_LOOK_YAW_RATE * dt;
      lookDelta.pitch -= applyDeadzone(clamp(this.touch.lookY, -1, 1), cs.gamepadDeadzone) * TOUCH_LOOK_PITCH_RATE * dt;
    }

    // --- mouse
    const sens = cs.mouseSensitivity;
    const mdx = this.touchActive ? 0 : this.mouseDX;
    const mdy = this.touchActive ? 0 : this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    let aimDirection: Vector3 | null = null;
    let mousePitch = 0;
    let mouseRoll = 0;
    let mouseYaw = 0;
    const leftDown = !this.touchActive && (this.mouseButtons & 1) !== 0;
    const rightDown = !this.touchActive && (this.mouseButtons & 2) !== 0;
    let stationAim: InputFrame['stationAim'];
    if (this.stationMode) {
      // Gunner: every mouse mode aims the gun (right button drags the view instead).
      const aimMouse = !rightDown && cs.mouseMode !== 'off';
      if (!aimMouse && (cs.mouseMode !== 'off' || leftDown || rightDown)) {
        lookDelta.yaw -= mdx * 0.003 * sens;
        lookDelta.pitch -= mdy * 0.003 * sens;
      }
      const inv = cs.invertPitch ? -1 : 1;
      stationAim = stationAimDelta(
        // readGamepad has applied invert pitch to padPitch already; stationAimDelta applies it once.
        { mouseDX: aimMouse ? mdx : 0, mouseDY: aimMouse ? mdy : 0, keyAz: kr, keyEl: kp, padAz: padRoll + touchRoll, padEl: padPitch * inv - touchPitch },
        cs,
        dt,
      );
      if (leftDown && cs.mouseMode !== 'off') fire = true;
    } else if (!this.touchActive && cs.mouseMode === 'mouse-aim' && player) {
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
    } else if (!this.touchActive && cs.mouseMode === 'direct-stick') {
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
    // At a gun the keys and stick aim it; they don't fly (and don't reset the mouse-aim point).
    const manualOverride = !this.stationMode && (this.touchActive || keyActive || padActive);
    const invertKeys = cs.invertPitch ? -1 : 1;
    let pitch: number, roll: number, yaw: number;
    if (this.stationMode) {
      pitch = roll = yaw = 0;
    } else if (cs.mouseMode === 'mouse-aim' && manualOverride) {
      pitch = this.keyPitch * invertKeys + padPitch + touchPitch * invertKeys;
      roll = this.keyRoll + padRoll + touchRoll;
      yaw = this.keyYaw + padYaw + touchYaw;
      if (player && !this.touchActive) this.resetAim(player); // re-sync aim with the nose after desktop manual flying
    } else {
      pitch = this.keyPitch * invertKeys + padPitch + mousePitch + touchPitch * invertKeys;
      roll = this.keyRoll + padRoll + mouseRoll + touchRoll;
      yaw = this.keyYaw + padYaw + mouseYaw + touchYaw;
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
        // Held, not an edge (lead decision): the sim drops one bomb per rising edge.
        releaseBomb: actions.has('releaseBomb') || !!g?.releaseBomb,
      },
      commands,
      snapLook,
      lookDelta,
      aimDirection,
      manualOverride,
      stationAim,
    };
  }
}
