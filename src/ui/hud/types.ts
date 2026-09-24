/**
 * In-flight HUD contract. The flight session (src/game) builds a `HudView`
 * each frame from the player entity, camera and world, and calls
 * `hud.update(view)`. All fields are plain data; units are SI (m, m/s, rad).
 *
 * Screen positions are normalised: x, y in 0..1 from the top-left of the
 * viewport. Screen-space angles are radians, 0 = up, clockwise positive.
 */
import type { GameSettings, Nation } from '../../core/types';
import type { MapView } from '../map/mapRenderer';

export type HudCameraView = 'cockpit' | 'chase' | 'padlock' | 'flyby' | 'target';

export interface HudGun {
  /** "Vickers L", "Lewis", "Spandau R"… */
  label: string;
  roundsLeft: number;
  /** Belt/drum capacity (for the fill bar). */
  capacity: number;
  /** Spare Lewis drums remaining (0 for belts). */
  spares: number;
  jammed: boolean;
  /** 0..1 progress of hammering a jam clear. */
  jamClearProgress: number;
  /** 0..1 drum-change progress; 0 when not reloading. */
  reloading: number;
  /** 0..1 barrel heat (optional). */
  heat?: number;
  /** Rear gun manned by an observer (shown dimmed). */
  observer?: boolean;
}

export interface HudDamage {
  /** 0 = pristine, 1 = destroyed. */
  engine: number;
  fuselage: number;
  leftWing: number;
  rightWing: number;
  tail: number;
  controls: number;
  fuelTank: number;
  onFire: boolean;
  smoking: boolean;
  fuelLeak: boolean;
  engineDead: boolean;
  pilotWounded: boolean;
}

export interface HudScreenPoint {
  x: number;
  y: number;
  /** True if the point is in front of the camera and inside the viewport. */
  onScreen: boolean;
  /** When off-screen: direction from screen centre to the point. */
  edgeAngle?: number;
}

export interface HudTarget {
  name: string;
  /** "Albatros D.V", "Observation balloon", "Supply dump"… */
  type: string;
  kind: 'aircraft' | 'balloon' | 'ground';
  friendly: boolean;
  /** Metres. */
  range: number;
  /** m/s, positive = closing. */
  closure: number;
  /** Degrees off the target's tail (0 = dead astern, 180 = head-on). */
  aspectDeg?: number;
  screen: HudScreenPoint;
  /** 0..1 visible damage estimate. */
  damage?: number;
  isAce?: boolean;
  /** Lead-computing aim point (optional; only drawn at 'relaxed' flight model). */
  lead?: HudScreenPoint;
}

export interface HudThreat {
  /** Screen-space angle to the threat (see header). */
  angle: number;
  distance: number;
  /** Behind/above and closing fast: drawn larger and pulsing. */
  danger: boolean;
}

export type WingmanStatus = 'ok' | 'engaged' | 'damaged' | 'rtb' | 'down' | 'landed';

export interface HudWingman {
  name: string;
  status: WingmanStatus;
  /** Last order acknowledged, e.g. "Form up". */
  order?: string;
}

export interface HudWaypoint {
  index: number;
  total: number;
  label: string;
  distance: number;
  screen: HudScreenPoint;
}

export interface HudView {
  nation: Nation;
  view: HudCameraView;
  /** Show the round-gauge instrument cluster (chase/external views; the 3D cockpit has its own). */
  showInstruments: boolean;
  /** Metres/second true airspeed. */
  airspeed: number;
  /** Metres above sea level. */
  altitude: number;
  heightAboveGround: number;
  /** m/s, positive = climbing. */
  verticalSpeed: number;
  /** Radians, 0 = north, clockwise. */
  heading: number;
  gLoad: number;
  rpm: number;
  maxRpm: number;
  /** 0..1 */
  throttle: number;
  blip: boolean;
  engineType: 'rotary' | 'inline' | 'twin-inline';
  fuelL: number;
  fuelCapacityL: number;
  stalled: boolean;
  onGround: boolean;
  guns: HudGun[];
  damage: HudDamage;
  target: HudTarget | null;
  /** Mouse-aim instructor: where the mouse aims (circle) and where the nose points (cross). */
  mouseAim?: { aim: HudScreenPoint; nose: HudScreenPoint } | null;
  padlock: { active: boolean; name?: string; lost?: boolean };
  threats: HudThreat[];
  wingmen: HudWingman[];
  waypoint: HudWaypoint | null;
  /** Where the fixed guns converge on screen (optional). */
  gunReticle?: HudScreenPoint | null;
  timeCompression: number;
  /** Seconds since mission start. */
  missionTime: number;
  /** Optional tutorial hint line. */
  hint?: string | null;
}

export type HudMessageKind = 'radio' | 'info' | 'warning' | 'victory' | 'objective';

export interface HudMessageOptions {
  from?: string;
  kind?: HudMessageKind;
  /** Seconds on screen (default 6). */
  duration?: number;
}

export interface PauseCallbacks {
  onResume(): void;
  onEndFlight(): void;
  onQuit(): void;
  onRestart?(): void;
}

export interface EndFlightPromptOptions {
  /** True when the flight can end without penalty (friendly ground, no enemies near). */
  safe: boolean;
  /** Explanation, e.g. "Enemy aircraft within 3 km". */
  reason?: string;
  onConfirm(): void;
  onCancel(): void;
}

export interface Hud {
  readonly element: HTMLElement;
  /** True while pause / end-flight / wingman menus capture input. */
  readonly menuOpen: boolean;
  update(view: HudView): void;
  showMessage(text: string, opts?: HudMessageOptions): void;
  /** Toggle the wingman orders card; the game handles the order keys. */
  showWingmanMenu(open: boolean): void;
  showPauseMenu(cb: PauseCallbacks): void;
  hidePauseMenu(): void;
  showEndFlightPrompt(o: EndFlightPromptOptions): void;
  hideEndFlightPrompt(): void;
  /** Show the paper map overlay (null hides it). Call again each frame to animate markers. */
  showMap(view: MapView | null): void;
  /** Blackout (0..1, grey tunnel) or red-out (negative, down to -1). */
  setGEffect(v: number): void;
  /** Red flash when hit, 0..1; decays automatically. */
  setDamageFlash(intensity: number): void;
  setVisible(visible: boolean): void;
  setSettings(s: GameSettings): void;
  dispose(): void;
}
