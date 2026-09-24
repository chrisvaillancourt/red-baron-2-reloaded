/** Shared types for UI screens. */
import type { MusicCue, GameServices } from '../core/interfaces';
import type { GameSettings, MissionDefinition, MissionResult } from '../core/types';

export type ScreenId =
  | 'title'
  | 'roster'
  | 'create-pilot'
  | 'hq'
  | 'briefing'
  | 'debrief'
  | 'quick'
  | 'options'
  | 'controls'
  | 'credits'
  | 'aces';

export interface Screen {
  el: HTMLElement;
  music?: MusicCue;
  /** Return true if the screen handled "back" itself (e.g. stepping through debrief pages). */
  onBack?(): boolean;
  onTab?(dir: -1 | 1): void;
  onShow?(): void;
  dispose?(): void;
}

export type ScreenParams = Record<string, unknown>;

export interface Router {
  readonly current: ScreenId;
  push(id: ScreenId, params?: ScreenParams): void;
  replace(id: ScreenId, params?: ScreenParams): void;
  /** Clear the stack and show `id`. */
  reset(id: ScreenId, params?: ScreenParams): void;
  back(): void;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface UiContext {
  readonly services: GameServices;
  readonly router: Router;
  readonly root: HTMLElement;
  settings(): GameSettings;
  updateSettings(mutate: (s: GameSettings) => void): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  toast(message: string): void;
  /** Hand the screen over to the flight session; resolves with the result (null if the flight failed). */
  fly(mission: MissionDefinition): Promise<MissionResult | null>;
}

export type ScreenFactory = (ctx: UiContext, params: ScreenParams) => Screen;
