/**
 * UI entry point. `createUi(root, services)` mounts the menu screens and
 * owns navigation between them; flights are delegated to
 * `services.launcher.fly()` and the in-flight HUD is created by the flight
 * session with `createHud()` (re-exported here).
 */
import './styles/ui.css';
import type { GameServices } from '../core/interfaces';
import type { GameSettings, MissionDefinition, MissionResult } from '../core/types';
import type { ConfirmOptions, Router, Screen, ScreenFactory, ScreenId, ScreenParams, UiContext } from './context';
import { h } from './dom';
import { createNav } from './nav';
import { titleScreen } from './screens/title';
import { rosterScreen } from './screens/roster';
import { createPilotScreen } from './screens/createPilot';
import { hqScreen } from './screens/hq';
import { briefingScreen } from './screens/briefing';
import { debriefScreen } from './screens/debrief';
import { quickScreen } from './screens/quick';
import { optionsScreen } from './screens/options';
import { controlsScreen, creditsScreen } from './screens/docs';
import { acesScreen } from './screens/aces';

export { createHud } from './hud/hud';
export type {
  Hud,
  HudView,
  HudGun,
  HudDamage,
  HudTarget,
  HudThreat,
  HudWingman,
  HudWaypoint,
  HudScreenPoint,
  HudCameraView,
  HudMessageOptions,
  WingmanStatus,
  PauseCallbacks,
  EndFlightPromptOptions,
} from './hud/types';
export { drawMap, createMapCanvas, missionMapView, fitMission } from './map/mapRenderer';
export type { MapView, MapMarker } from './map/mapRenderer';
export { setUiCatalog } from './catalog';
export { catalogFromCampaignData } from './campaignCatalog';
export type { UiCatalog, RankDisplay, MedalDisplay, AceDisplay } from './catalog';
export type { ScreenId } from './context';
export * as uiFormat from './format';

const SCREENS: Record<ScreenId, ScreenFactory> = {
  title: titleScreen,
  roster: rosterScreen,
  'create-pilot': createPilotScreen,
  hq: hqScreen,
  briefing: briefingScreen,
  debrief: debriefScreen,
  quick: quickScreen,
  options: optionsScreen,
  controls: controlsScreen,
  credits: creditsScreen,
  aces: acesScreen,
};

export interface UiOptions {
  /** Element that receives the flight container (default: document.body). */
  flightHost?: HTMLElement;
  /** First screen (default 'title'). */
  initialScreen?: ScreenId;
  initialParams?: ScreenParams;
}

export interface UiController {
  readonly current: ScreenId;
  show(id: ScreenId, params?: ScreenParams): void;
  back(): void;
  /** Hide/show the menu layer (e.g. while the game shows something else). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createUi(root: HTMLElement, services: GameServices, opts: UiOptions = {}): UiController {
  const layer = h('div', { class: 'rb-ui' });
  root.append(layer);

  const stack: { id: ScreenId; params: ScreenParams }[] = [];
  let screen: Screen | null = null;
  let currentId: ScreenId = opts.initialScreen ?? 'title';
  let flying = false;
  const modals: HTMLElement[] = [];

  const nav = createNav({
    scope: () => modals[modals.length - 1] ?? screen?.el ?? null,
    onBack: () => {
      if (modals.length) {
        (modals[modals.length - 1].querySelector('[data-cancel]') as HTMLElement | null)?.click();
        return;
      }
      if (screen?.onBack?.()) return;
      router.back();
    },
    onTab: (dir) => screen?.onTab?.(dir),
  });

  function mount(id: ScreenId, params: ScreenParams): void {
    const prev = screen;
    if (prev) {
      prev.dispose?.();
      prev.el.classList.add('leaving');
      setTimeout(() => prev.el.remove(), 260);
    }
    currentId = id;
    try {
      screen = SCREENS[id](ctx, params);
    } catch (err) {
      console.error(`[ui] screen ${id} failed`, err);
      screen = SCREENS.title(ctx, {});
      currentId = 'title';
      toast('Something went wrong opening that screen.');
    }
    layer.append(screen.el);
    if (screen.music) services.audio.playMusic(screen.music);
    screen.onShow?.();
    requestAnimationFrame(() => nav.focusFirst(screen?.el));
  }

  const router: Router = {
    get current() {
      return currentId;
    },
    push(id, params = {}) {
      stack.push({ id, params });
      mount(id, params);
    },
    replace(id, params = {}) {
      stack.pop();
      stack.push({ id, params });
      mount(id, params);
    },
    reset(id, params = {}) {
      stack.length = 0;
      stack.push({ id, params });
      mount(id, params);
    },
    back() {
      if (stack.length <= 1) return;
      stack.pop();
      const top = stack[stack.length - 1];
      services.audio.playUi('back');
      mount(top.id, top.params);
    },
  };

  function toast(message: string): void {
    const t = h('div', { class: 'rb-toast paper' }, message);
    layer.append(t);
    setTimeout(() => t.remove(), 3600);
  }

  function confirm(o: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement as HTMLElement | null;
      const close = (v: boolean) => {
        backdrop.remove();
        modals.splice(modals.indexOf(backdrop), 1);
        prevFocus?.focus?.();
        resolve(v);
      };
      const backdrop = h(
        'div',
        { class: 'rb-modal-backdrop', role: 'dialog', 'aria-modal': 'true' },
        h(
          'div',
          { class: 'rb-modal paper' },
          h('h2', null, o.title),
          h('p', { class: 'typed' }, o.body),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn', 'data-cancel': '', onClick: () => close(false) }, o.cancelLabel ?? 'Cancel'),
            h('button', { class: `btn primary ${o.danger ? 'danger' : ''}`, 'data-autofocus': '', onClick: () => close(true) }, o.confirmLabel ?? 'Confirm'),
          ),
        ),
      );
      modals.push(backdrop);
      layer.append(backdrop);
      requestAnimationFrame(() => nav.focusFirst(backdrop));
    });
  }

  async function fly(mission: MissionDefinition): Promise<MissionResult | null> {
    if (flying) return null;
    flying = true;
    const host = h('div', { class: 'rb-flight-host' });
    (opts.flightHost ?? document.body).append(host);
    layer.hidden = true;
    nav.setActive(false);
    services.audio.playMusic('flight');
    try {
      return await services.launcher.fly(mission, services.getSettings(), host);
    } catch (err) {
      console.error('[ui] flight failed', err);
      toast('The flight could not be started.');
      return null;
    } finally {
      host.remove();
      layer.hidden = false;
      nav.setActive(true);
      flying = false;
    }
  }

  const ctx: UiContext = {
    services,
    router,
    root: layer,
    settings: () => services.getSettings(),
    updateSettings(mutate: (s: GameSettings) => void) {
      const s = structuredClone(services.getSettings());
      mutate(s);
      services.saveSettings(s);
      services.audio.setVolumes(s.masterVolume, s.musicVolume, s.effectsVolume);
    },
    confirm,
    toast,
    fly,
  };

  // UI sounds + audio unlock on first gesture.
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    void services.audio.resume().then(() => {
      if (screen?.music) services.audio.playMusic(screen.music);
    });
  };
  const onPointer = () => unlock();
  const onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button, .choice, .tab');
    if (b && !b.hasAttribute('data-silent')) services.audio.playUi(b.classList.contains('primary') ? 'confirm' : 'click');
  };
  let lastHover = 0;
  const onOver = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('.plaque, .dossier, .choice');
    if (b && performance.now() - lastHover > 90) {
      lastHover = performance.now();
      services.audio.playUi('hover');
    }
  };
  layer.addEventListener('pointerdown', onPointer);
  layer.addEventListener('click', onClick);
  layer.addEventListener('mouseover', onOver);
  window.addEventListener('keydown', unlock, { once: true });

  router.reset(currentId, opts.initialParams ?? {});

  return {
    get current() {
      return currentId;
    },
    show: (id, params) => router.push(id, params),
    back: () => router.back(),
    setVisible(v) {
      layer.hidden = !v;
      nav.setActive(v && !flying);
    },
    dispose() {
      screen?.dispose?.();
      nav.dispose();
      layer.remove();
    },
  };
}
