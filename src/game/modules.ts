/**
 * COMPOSITION POINT. The only place that binds subsystem implementations.
 * Entries still bound to ./stubs are swapped as their modules land
 * (see docs/game.md "Swapping stubs").
 */
import { createAIController } from '../ai';
import { createAudioEngine } from '../audio';
import { createCampaignService } from '../campaign';
import { createCombatSystem, createFlightEnvironment, setGunnerTarget, sim } from '../sim';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import type { GameModules } from './moduleTypes';
import { stubCreateAircraftVisual, stubPreloadAircraftModels } from './stubs/aircraftVisual';
import { stubCreateHud } from './stubs/hud';
import { stubCreateWorldRenderer } from './stubs/renderer';
import { stubCreateUi } from './stubs/ui';

export const modules: GameModules = {
  // src/sim
  sim,
  createFlightEnvironment,
  createCombatSystem: (bus, getRealism) => createCombatSystem(bus, getRealism),
  setGunnerTarget,
  // src/render
  createWorldRenderer: stubCreateWorldRenderer,
  // src/render/aircraft
  createAircraftVisual: stubCreateAircraftVisual,
  preloadAircraftModels: stubPreloadAircraftModels,
  // src/ai — adapt the game's per-slot options to the AI's vic-slot options.
  createAIController: (ac, o) =>
    createAIController(ac, {
      role: o.flight.role,
      task: o.flight.task,
      skill: o.skill,
      leaderId: o.leaderId === ac.id ? undefined : o.leaderId,
      formationSlot: o.slot > 0 ? o.slot : undefined,
      realism: o.realism,
      setGunnerTarget,
      homeAerodromeId: o.homeAerodromeId,
    }),
  // src/audio
  createAudioEngine: () => createAudioEngine(),
  // src/campaign
  createCampaignService: () => createCampaignService(),
  // src/ui
  createUi: stubCreateUi,
  createHud: stubCreateHud,
  // src/world
  terrainHeightAt,
  sideOfFrontAt,
};
