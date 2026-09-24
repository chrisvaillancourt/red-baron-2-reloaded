/**
 * COMPOSITION POINT. The only place that binds subsystem implementations.
 * Each entry is currently a stub from ./stubs; swap an import here to bring
 * a real module online (see docs/game.md "Swapping stubs").
 */
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import type { GameModules } from './moduleTypes';
import { stubCreateAIController } from './stubs/ai';
import { stubCreateAircraftVisual, stubPreloadAircraftModels } from './stubs/aircraftVisual';
import { stubCreateAudioEngine } from './stubs/audio';
import { stubCreateCampaignService } from './stubs/campaign';
import { stubCreateCombatSystem, stubSetGunnerTarget } from './stubs/combat';
import { stubCreateHud } from './stubs/hud';
import { stubCreateWorldRenderer } from './stubs/renderer';
import { stubCreateFlightEnvironment, stubSim } from './stubs/sim';
import { stubCreateUi } from './stubs/ui';

export const modules: GameModules = {
  // src/sim
  sim: stubSim,
  createFlightEnvironment: stubCreateFlightEnvironment,
  createCombatSystem: stubCreateCombatSystem,
  setGunnerTarget: stubSetGunnerTarget,
  // src/render
  createWorldRenderer: stubCreateWorldRenderer,
  // src/render/aircraft
  createAircraftVisual: stubCreateAircraftVisual,
  preloadAircraftModels: stubPreloadAircraftModels,
  // src/ai
  createAIController: stubCreateAIController,
  // src/audio
  createAudioEngine: stubCreateAudioEngine,
  // src/campaign
  createCampaignService: stubCreateCampaignService,
  // src/ui
  createUi: stubCreateUi,
  createHud: stubCreateHud,
  // src/world (real modules; the lead's stubs today, the world agent's later)
  terrainHeightAt,
  sideOfFrontAt,
};
