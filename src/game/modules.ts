/**
 * COMPOSITION POINT. The only place that binds subsystem implementations.
 * Entries still bound to ./stubs are swapped as their modules land
 * (see docs/game.md "Swapping stubs").
 */
import { createAIController } from '../ai';
import { createAudioEngine } from '../audio';
import { createCampaignService } from '../campaign';
import { createHud, createUi } from '../ui';
import { createAircraftVisual, preloadAircraftModels } from '../render/aircraft';
import { createWorldRenderer } from '../render/worldRenderer';
import { createCombatSystem, createFlightEnvironment, setGunnerTarget, sim } from '../sim';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import type { GameModules } from './moduleTypes';

export const modules: GameModules = {
  // src/sim
  sim,
  createFlightEnvironment,
  createCombatSystem: (bus, getRealism) => createCombatSystem(bus, getRealism),
  setGunnerTarget,
  // src/render
  createWorldRenderer: (canvas, opts) => createWorldRenderer(canvas, opts),
  // src/render/aircraft
  createAircraftVisual,
  preloadAircraftModels: (ids) => preloadAircraftModels(ids),
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
  createUi: (root, services) => createUi(root, services),
  createHud,
  // src/world
  terrainHeightAt,
  sideOfFrontAt,
};
