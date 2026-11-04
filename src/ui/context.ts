/** Shared types for UI screens. */
import type { MusicCue, GameServices } from '../core/interfaces';
import type { GameSettings, MissionDefinition, MissionResult } from '../core/types';
import type { DefenseOptions, DefenseResult } from '../core/defense';
import type { DebriefReport, QuickMissionOptions } from '../core/campaignTypes';

export type ScreenId =
  | 'title'
  | 'roster'
  | 'create-pilot'
  | 'hq'
  | 'briefing'
  | 'debrief'
  | 'quick'
  | 'defense-briefing'
  | 'defense-report'
  | 'gunner-guide'
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

/**
 * Untyped params at the loose entry points (UiController.show, UiOptions.initialParams,
 * window.__rb2ui), which dev tools drive from URLs and scripts.
 */
export type ScreenParams = Record<string, unknown>;

/** A screen that takes no params. Unlike `{}`, this rejects stray keys. */
type NoParams = Record<string, never>;

/** The params each screen accepts; router calls and screen factories are checked against it. */
export interface ScreenParamMap {
  title: NoParams;
  roster: NoParams;
  'create-pilot': NoParams;
  hq: { pilotId: string; welcome?: boolean };
  briefing: { mission: MissionDefinition; pilotId?: string; quickOptions?: QuickMissionOptions };
  debrief: {
    mission: MissionDefinition;
    result: MissionResult;
    report?: DebriefReport;
    pilotId?: string;
    quickOptions?: QuickMissionOptions;
  };
  quick: NoParams;
  'defense-briefing': {
    /**
     * Draft the router retains across Gunner's Guide/Options visits. The screen writes it
     * back into this params object, and router.back() remounts the same object from the
     * stack, so the field must stay mutable (docs/ui.md "Airfield Defense").
     */
    options?: DefenseOptions;
  };
  'defense-report': { result: DefenseResult };
  'gunner-guide': NoParams;
  options: NoParams;
  controls: NoParams;
  credits: NoParams;
  aces: NoParams;
}

/** Params are optional for screens whose params are all optional, required otherwise. */
export type ScreenParamArgs<K extends ScreenId> = {} extends ScreenParamMap[K]
  ? [params?: ScreenParamMap[K]]
  : [params: ScreenParamMap[K]];

export interface Router {
  readonly current: ScreenId;
  push<K extends ScreenId>(id: K, ...params: ScreenParamArgs<K>): void;
  replace<K extends ScreenId>(id: K, ...params: ScreenParamArgs<K>): void;
  /** Clear the stack and show `id`. */
  reset<K extends ScreenId>(id: K, ...params: ScreenParamArgs<K>): void;
  back(): void;
}

export interface ConfirmOptions {
  title: string;
  /** Plain text (typed paragraph) or rich content. */
  body: string | HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Information card: a single acknowledge button, no cancel. */
  infoOnly?: boolean;
  /** Extra class on the modal paper (e.g. 'wide'). */
  className?: string;
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
  /** Run an independent battery defense; null on launcher failure or UI disposal. */
  defend(options: DefenseOptions): Promise<DefenseResult | null>;
}

export type ScreenFactory<K extends ScreenId = ScreenId> = (ctx: UiContext, params: ScreenParamMap[K]) => Screen;
