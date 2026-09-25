/**
 * App bootstrap: settings, services, display catalog, UI mount, and error
 * recovery. Audio is unlocked by the UI on the first gesture.
 */
import type { GameServices } from '../core/interfaces';
import { loadSettings, saveSettings } from '../core/settings';
import type { GameSettings } from '../core/types';
import { catalogFromCampaignData, setUiCatalog } from '../ui';
import { abortActiveFlight } from './activeFlight';
import { isBenignError, setRecoveryHandler, showFatalError } from './errorOverlay';
import { createLazyFlightLauncher, prefetchFlightChunk } from './modules';
import type { MenuModules, UiHandle } from './moduleTypes';

export { showFatalError } from './errorOverlay';

export interface App {
  services: GameServices;
  readonly ui: UiHandle;
  /** Abort any flight and remount the UI at the title screen (fatal-error recovery). */
  restart(): void;
}

/**
 * Boot the menus. The flight half of the composition point loads on the first
 * take-off (prefetched once the browser is idle); see src/game/modules.ts.
 */
export function startApp(root: HTMLElement, modules: MenuModules): App {
  let settings: GameSettings = loadSettings();
  const audio = modules.createAudioEngine();
  audio.setVolumes(settings.masterVolume, settings.musicVolume, settings.effectsVolume);
  const services: GameServices = {
    campaign: modules.createCampaignService(),
    audio,
    launcher: createLazyFlightLauncher(modules, audio),
    getSettings: () => settings,
    saveSettings(s) {
      settings = s;
      saveSettings(s);
      audio.setVolumes(s.masterVolume, s.musicVolume, s.effectsVolume);
    },
  };

  // Rank/medal/ace names in the UI come from the campaign's data.
  setUiCatalog(catalogFromCampaignData());

  window.__rb2 = { session: null, ...window.__rb2, services };
  let ui = modules.createUi(root, services);
  const app: App = {
    services,
    get ui() {
      return ui;
    },
    restart() {
      abortActiveFlight(new Error('Aborted to recover from an error'), { silent: true });
      try {
        ui.dispose();
      } catch (e) {
        console.warn('[rb2] UI dispose failed during recovery', e);
      }
      root.replaceChildren();
      ui = modules.createUi(root, services);
    },
  };
  setRecoveryHandler(() => app.restart());
  prefetchFlightChunk();
  return app;
}

/** Route uncaught errors to the recoverable fatal overlay (ignoring browser noise). */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    const err = e.error ?? e.message;
    if (isBenignError(err)) return;
    showFatalError(err);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isBenignError(e.reason)) return;
    showFatalError(e.reason);
  });
}
