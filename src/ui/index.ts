/**
 * UI entry point. `createUi(root, services)` mounts the menu screens and
 * owns navigation between them; flights are delegated to
 * `services.launcher.fly()` and the in-flight HUD is created by the flight
 * session with `createHud()` (re-exported here).
 */
import './styles/ui.css';
import type { GameServices } from '../core/interfaces';
import type { GameSettings, MissionDefinition, MissionResult } from '../core/types';
import type { DefenseOptions, DefenseResult } from '../core/defense';
import { abortActiveDefense } from '../game/activeDefense';
import { wasErrorReported } from '../core/flightErrors';
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
import { defenseBriefingScreen, defenseReportScreen, gunnerGuideScreen } from './screens/defense';
import { optionsScreen } from './screens/options';
import { controlsScreen, creditsScreen } from './screens/docs';
import { acesScreen } from './screens/aces';
import { onPadChange } from './gamepad';

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
  'defense-briefing': defenseBriefingScreen,
  'defense-report': defenseReportScreen,
  'gunner-guide': gunnerGuideScreen,
  options: optionsScreen,
  controls: controlsScreen,
  credits: creditsScreen,
  aces: acesScreen,
};

export interface UiOptions {
  /** Element that receives a flight or defense container (default: document.body). */
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
  let session: 'flight' | 'defense' | null = null;
  let defenseHost: HTMLElement | null = null;
  let disposed = false;
  let visible = true;
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
    if (disposed) return;
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
    if (!session && screen.music) services.audio.playMusic(screen.music);
    screen.onShow?.();
    requestAnimationFrame(() => {
      if (!disposed && !session && visible) nav.focusFirst(screen?.el);
    });
  }

  const router: Router = {
    get current() {
      return currentId;
    },
    push(id, params = {}) {
      if (disposed) return;
      stack.push({ id, params });
      mount(id, params);
    },
    replace(id, params = {}) {
      if (disposed) return;
      stack.pop();
      stack.push({ id, params });
      mount(id, params);
    },
    reset(id, params = {}) {
      if (disposed) return;
      stack.length = 0;
      stack.push({ id, params });
      mount(id, params);
    },
    back() {
      if (disposed) return;
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
          { class: `rb-modal paper ${o.className ?? ''}` },
          h('h2', null, o.title),
          typeof o.body === 'string' ? h('p', { class: 'typed' }, o.body) : o.body,
          h(
            'div',
            { class: 'actions' },
            // Info cards keep a hidden cancel target so Esc/B still closes them.
            h('button', { class: 'btn', 'data-cancel': '', hidden: o.infoOnly || undefined, onClick: () => close(false) }, o.cancelLabel ?? 'Cancel'),
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
    if (disposed || session) return null;
    session = 'flight';
    const host = h('div', { class: 'rb-flight-host' });
    (opts.flightHost ?? document.body).append(host);
    layer.hidden = true;
    nav.setActive(false);
    services.audio.playMusic('flight');
    try {
      return await services.launcher.fly(mission, services.getSettings(), host);
    } catch (err) {
      console.error('[ui] flight failed', err);
      // The session shows its own card for failures it caught (in setup or in the air);
      // the toast covers the rest, e.g. the flight code failing to download.
      if (!wasErrorReported(err)) toast('The flight could not be started.');
      return null;
    } finally {
      host.remove();
      session = null;
      if (!disposed) {
        layer.hidden = !visible;
        nav.setActive(visible);
      }
    }
  }

  async function defend(options: DefenseOptions): Promise<DefenseResult | null> {
    if (disposed || session) return null;
    const launcher = services.defense;
    if (!launcher) {
      toast('Airfield Defense is not available in this flight-only tool.');
      return null;
    }
    session = 'defense';
    const previousFocus = document.activeElement as HTMLElement | null;
    const host = h('div', { class: 'rb-flight-host rb-defense-host', dataset: { session: 'airfield-defense' } });
    defenseHost = host;
    try {
      (opts.flightHost ?? document.body).append(host);
      layer.hidden = true;
      nav.setActive(false);
      services.audio.playMusic('flight');
      const result = await launcher.defend({ ...options }, services.getSettings(), host);
      return disposed ? null : result;
    } catch (err) {
      if (!disposed) {
        console.error('[ui] defense failed', err);
        if (!wasErrorReported(err)) toast('The defense was interrupted. You can try again from this screen.');
      }
      return null;
    } finally {
      host.remove();
      defenseHost = null;
      session = null;
      if (!disposed) {
        layer.hidden = !visible;
        nav.setActive(visible);
        services.audio.playMusic(screen?.music ?? 'menu');
        requestAnimationFrame(() => {
          if (disposed || session || !visible) return;
          if (previousFocus?.isConnected && screen?.el.contains(previousFocus)) previousFocus.focus();
          else nav.focusFirst(screen?.el);
        });
      }
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
    defend,
  };

  // UI sounds + audio unlock on first gesture.
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    void services.audio.resume().then(() => {
      if (!disposed && !session && screen?.music) services.audio.playMusic(screen.music);
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

  const controller: UiController = {
    get current() {
      return currentId;
    },
    show: (id, params) => router.push(id, params),
    back: () => router.back(),
    setVisible(v) {
      if (disposed) return;
      visible = v;
      layer.hidden = !v || !!session;
      nav.setActive(v && !session);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        if (session === 'defense') abortActiveDefense(new Error('Defense menu disposed'));
      } finally {
        defenseHost?.remove();
        screen?.dispose?.();
        nav.dispose();
        unsubPad();
        window.removeEventListener('keydown', unlock);
        layer.remove();
      }
    },
  };
  const unsubPad = onPadChange((name, connected) => {
    if (!services.getSettings().controls.gamepadEnabled) return;
    toast(connected ? `${name} connected — ready to fly.` : `${name} disconnected.`);
  });
  // Dev-only QA hook: lets Playwright scripts jump to screens with real data.
  if (import.meta.env?.DEV) window.__rb2ui = controller;
  return controller;
}

declare global {
  interface Window {
    /** Dev-only UI router hook for Playwright scripts and e2e (set in dev builds only; FRICTION F-5). */
    __rb2ui?: UiController;
  }
}
