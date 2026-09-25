/**
 * COMPOSITION POINT. The only place that binds subsystem implementations.
 *
 * Split in two (DECISIONS "Flight code is a lazily loaded chunk"):
 *  - `menuModules`: what the menus need at boot (audio, campaign, UI).
 *  - `loadFlightModules()`: everything else, from ./flightModules, fetched as a
 *    separate chunk the first time a flight starts (and prefetched when idle).
 * `GameModules` (./moduleTypes) is the union of the two.
 */
import { createAudioEngine } from '../audio';
import { createCampaignService } from '../campaign';
import { createUi } from '../ui';
import type { FlightLauncher } from '../core/interfaces';
import type { AudioEngine } from '../core/interfaces';
import type { FlightOnlyModules, GameModules, MenuModules } from './moduleTypes';

export const menuModules: MenuModules = {
  // src/audio
  createAudioEngine: () => createAudioEngine(),
  // src/campaign
  createCampaignService: () => createCampaignService(),
  // src/ui
  createUi: (root, services) => createUi(root, services),
};

type FlightChunk = typeof import('./flightModules');
let chunk: Promise<FlightChunk> | null = null;

/** Fetch the flight chunk once; later calls share the same promise. */
export function loadFlightChunk(): Promise<FlightChunk> {
  if (!chunk) {
    chunk = import('./flightModules');
    chunk.catch(() => (chunk = null)); // a failed fetch (offline blip) may be retried
  }
  return chunk;
}

export async function loadFlightModules(): Promise<FlightOnlyModules> {
  return (await loadFlightChunk()).flightModules;
}

/** A FlightLauncher that loads the flight chunk on first use. */
export function createLazyFlightLauncher(menu: MenuModules, audio: AudioEngine): FlightLauncher {
  let launcher: FlightLauncher | null = null;
  return {
    async fly(mission, settings, container) {
      if (!launcher) {
        const c = await loadFlightChunk();
        const modules: GameModules = { ...menu, ...c.flightModules };
        launcher = c.createFlightLauncher(modules, audio);
      }
      return launcher.fly(mission, settings, container);
    },
  };
}

/** Start fetching the flight chunk once the browser is idle, so take-off doesn't wait on it. */
export function prefetchFlightChunk(): void {
  const go = () => void loadFlightChunk().catch(() => undefined);
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}
