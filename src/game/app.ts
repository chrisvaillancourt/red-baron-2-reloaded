/**
 * App bootstrap: settings, services, display catalog, UI mount, and a
 * fatal-error overlay. Audio is unlocked by the UI on the first gesture.
 */
import type { GameServices } from '../core/interfaces';
import { loadSettings, saveSettings } from '../core/settings';
import type { GameSettings } from '../core/types';
import { catalogFromCampaignData, setUiCatalog } from '../ui';
import { createFlightLauncher } from './flightSession';
import type { GameModules, UiHandle } from './moduleTypes';

export interface App {
  services: GameServices;
  ui: UiHandle;
}

export function showFatalError(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  let el = document.getElementById('rb-fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rb-fatal';
    el.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(20,10,8,.94);color:#f4d8c8;font:13px ui-monospace,Menlo,monospace;padding:32px;white-space:pre-wrap;overflow:auto';
    document.body.appendChild(el);
  }
  el.textContent = `Red Baron II: Reloaded hit a fatal error.\n\n${msg}\n\nReload the page to continue.`;
}

export function startApp(root: HTMLElement, modules: GameModules): App {
  let settings: GameSettings = loadSettings();
  const audio = modules.createAudioEngine();
  audio.setVolumes(settings.masterVolume, settings.musicVolume, settings.effectsVolume);
  const services: GameServices = {
    campaign: modules.createCampaignService(),
    audio,
    launcher: createFlightLauncher(modules, audio),
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
  const ui = modules.createUi(root, services);
  return { services, ui };
}
