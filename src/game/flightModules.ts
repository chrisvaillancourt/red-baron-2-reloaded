/**
 * COMPOSITION POINT, flight half: every subsystem only a flight needs (sim,
 * AI, world renderer, aircraft visuals, HUD, terrain queries). Loaded on
 * demand by the launcher (src/game/modules.ts) so the menus start without
 * three's WebGL renderer, the flight model or the AI in the first download.
 */
import { createAIController } from '../ai';
import { createHud } from '../ui/hud/hud';
import { createAircraftVisual, preloadAircraftModels } from '../render/aircraft';
import { createWorldRenderer } from '../render/worldRenderer';
import { createCombatSystem, createFlightEnvironment, setGunnerTarget, sim } from '../sim';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import type { FlightOnlyModules } from './moduleTypes';

export { createFlightLauncher } from './flightSession';

export const flightModules: FlightOnlyModules = {
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
  // src/ui (in-flight HUD)
  createHud,
  // src/world
  terrainHeightAt,
  sideOfFrontAt,
};
