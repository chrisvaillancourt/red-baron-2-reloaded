/**
 * Factory signatures the flight session and app expect from each subsystem.
 * `src/game/modules.ts` binds these to implementations (real or stub).
 *
 * Where a subsystem's own API is not yet fixed by src/core/interfaces.ts,
 * the shapes below are the game layer's assumption (see docs/game.md).
 */
import type {
  AIController,
  AircraftVisualFactory,
  AudioEngine,
  CampaignService,
  CombatSystem,
  EventBus,
  GameServices,
  SimModule,
  WorldRenderer,
} from '../core/interfaces';
import type {
  AircraftEntity,
  AircraftId,
  FlightEnvironment,
  GameSettings,
  Weather,
  GraphicsQuality,
  MissionFlight,
  RealismSettings,
  Side,
  SkillLevel,
} from '../core/types';
import type { HudFrame } from './hudView';

export interface WorldRendererOptions {
  quality: GraphicsQuality;
  date: string;
}

export interface AIControllerOptions {
  skill: SkillLevel;
  flight: MissionFlight;
  /** Index of this aircraft within its flight (0 = leader). */
  slot: number;
  /** Entity id of the flight leader (== own id for the leader). */
  leaderId: number;
  realism: RealismSettings;
}

/** In-flight HUD handle. The real UI's HUD is adapted to this in modules.ts. */
export interface HudHandle {
  update(frame: HudFrame): void;
  /** Radio/system message line. */
  showMessage(text: string, from?: string): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface UiHandle {
  dispose(): void;
}

export interface GameModules {
  sim: SimModule;
  createFlightEnvironment(groundHeightAt: (x: number, z: number) => number, weather: Weather): FlightEnvironment;
  createCombatSystem(bus: EventBus, getRealism: () => RealismSettings): CombatSystem;
  /** Tell combat which entity a flexible (rear) gun should engage; null to hold fire. */
  setGunnerTarget(ac: AircraftEntity, targetId: number | null): void;
  createWorldRenderer(canvas: HTMLCanvasElement, opts: WorldRendererOptions): WorldRenderer;
  createAircraftVisual: AircraftVisualFactory;
  preloadAircraftModels(ids: AircraftId[]): Promise<void>;
  createAIController(ac: AircraftEntity, opts: AIControllerOptions): AIController;
  createAudioEngine(): AudioEngine;
  createCampaignService(): CampaignService;
  createUi(root: HTMLElement, services: GameServices): UiHandle;
  createHud(container: HTMLElement, settings: GameSettings): HudHandle;
  terrainHeightAt(x: number, z: number): number;
  sideOfFrontAt(x: number, z: number, date: string): Side;
}
