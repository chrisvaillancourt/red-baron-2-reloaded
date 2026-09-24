/**
 * App bootstrap: settings, services, UI mount, audio unlock on the first
 * user gesture, and a fatal-error overlay.
 */
import type { GameServices } from '../core/interfaces';
import { loadSettings, saveSettings } from '../core/settings';
import type { GameSettings } from '../core/types';
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

  const unlock = () => {
    audio.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  window.__rb2 = { session: null, ...window.__rb2, services };
  const ui = modules.createUi(root, services);
  return { services, ui };
}
