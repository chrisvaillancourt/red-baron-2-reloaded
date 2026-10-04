import type { EdgeAction } from './input';

/** Normalized touch rates, independent of DOM pointer ownership. */
export interface TouchInputState {
  /** Screen axes: right/down positive. Down pulls the pilot's stick back;
   * at a gun, up raises the aim. InputManager applies inversion once. */
  stickX: number;
  stickY: number;
  /** Right rudder positive, -1..1. */
  rudder: number;
  /** Screen look-pad rates: right/down positive, -1..1. */
  lookX: number;
  lookY: number;
  fire: boolean;
  blip: boolean;
}

/** UI sends intent only; game input owns settings, throttle and frame conversion. */
export interface TouchControlSink {
  state(change: Partial<TouchInputState>): void;
  throttle(value: number): void;
  command(action: EdgeAction): void;
  cancel(): void;
  /** Called synchronously from trusted gestures to resume suspended audio. */
  gesture(): void;
  /** Opening the actions sheet captures input and pauses; closing releases capture. */
  capture(open: boolean): void;
  active(value: boolean): void;
}

export interface TouchControlView {
  active: boolean;
  /** Another dialog or an interruption owns the controls. */
  blocked: boolean;
  throttle: number;
  stationLabel: string;
  hasCrew: boolean;
  hasBombs: boolean;
}

export interface TouchControls {
  update(view: TouchControlView): void;
  cancel(): void;
  dispose(): void;
}
