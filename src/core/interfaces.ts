/**
 * Module-boundary interfaces. Each subsystem implements the interface(s)
 * named for it; the flight session (src/game) composes them.
 *
 * Ownership (see docs/ARCHITECTURE.md):
 *   src/sim       -> stepFlight, createFlightState, CombatSystem
 *   src/ai        -> AIController factory
 *   src/world     -> terrain height + front lines (pure, no three.js scene code)
 *   src/render    -> WorldRenderer, AircraftVisual factory
 *   src/audio     -> AudioEngine
 *   src/campaign  -> CampaignService, quick-mission builder
 *   src/ui        -> screens, HUD
 *   src/game      -> app bootstrap, FlightSession, input, cameras
 */
import type { Camera, Object3D, Scene, Vector3, WebGLRenderer } from 'three';
import type {
  AircraftEntity,
  AircraftSpec,
  AircraftId,
  BalloonEntity,
  Entity,
  FlightEnvironment,
  GameEvent,
  GameSettings,
  GroundTargetEntity,
  GroundTargetType,
  Livery,
  MissionDefinition,
  MissionFlight,
  MissionResult,
  RealismSettings,
  Side,
  TimeOfDay,
  Weather,
} from './types';
import type {
  CareerPilot,
  DebriefReport,
  NewPilotOptions,
  PilotSummary,
  QuickMissionOptions,
  SquadronInfo,
  AceStanding,
} from './campaignTypes';

// ---------------------------------------------------------------------------
// Event bus (implemented in src/core/events.ts)
// ---------------------------------------------------------------------------

export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export interface EventBus {
  emit(event: GameEvent): void;
  on<T extends GameEventType>(type: T, handler: (e: GameEventOf<T>) => void): () => void;
  onAny(handler: (e: GameEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// World query: read-only view of the live flight session for AI/combat/HUD.
// ---------------------------------------------------------------------------

export interface WorldQuery {
  /** Mission time in seconds. */
  readonly time: number;
  readonly date: string;
  readonly aircraft: readonly AircraftEntity[];
  readonly balloons: readonly BalloonEntity[];
  readonly groundTargets: readonly GroundTargetEntity[];
  getEntity(id: number): Entity | undefined;
  groundHeightAt(x: number, z: number): number;
  /** Which side holds the ground at (x, z) on the mission date. */
  sideOfFrontAt(x: number, z: number): Side;
  /** Mission flight definition by id (waypoints, task, escort target...). */
  getFlight(flightId: string): MissionFlight | undefined;
  readonly env: FlightEnvironment;
}

// ---------------------------------------------------------------------------
// src/sim
// ---------------------------------------------------------------------------

export interface SimModule {
  /** Build a fresh entity-ready flight state at the given start. */
  createFlightState(
    spec: AircraftSpec,
    start: { x: number; z: number; altitude: number; heading: number; airspeed: number },
    env: FlightEnvironment,
    onGround: boolean,
  ): AircraftEntity['state'];
  /** Advance one aircraft's rigid-body flight model by dt (fixed step, <= 1/60 s). */
  stepFlight(ac: AircraftEntity, env: FlightEnvironment, realism: RealismSettings, dt: number): void;
}

/** A live bullet, exposed read-only for tracer rendering. */
export interface BulletView {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly tracer: boolean;
  readonly side: Side;
  readonly age: number;
}

export interface CombatSystem {
  readonly bullets: readonly BulletView[];
  /** Fire guns per controls, move bullets, resolve hits/damage/jams/collisions, emit events. */
  update(world: WorldQuery, dt: number): void;
  /** Flak/AA bursts owned by combat too (ground AA guns fire at enemies in range). */
}

// ---------------------------------------------------------------------------
// src/ai
// ---------------------------------------------------------------------------

export type WingmanCommand = 'attack-my-target' | 'engage-at-will' | 'form-up' | 'cover-me' | 'return-home';

export interface AIController {
  readonly entityId: number;
  /** Write self.controls for this frame. Called at the sim rate or lower. */
  update(self: AircraftEntity, world: WorldQuery, dt: number): void;
  command(cmd: WingmanCommand, targetId?: number): void;
  /** Short state label for debug overlay: "pursue #4", "evade", "rtb"... */
  readonly debugState: string;
}

// ---------------------------------------------------------------------------
// src/render
// ---------------------------------------------------------------------------

export interface WorldRenderer {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  /** Recommended camera clip planes (optional; defaults 0.2 / 60000). */
  readonly near?: number;
  readonly far?: number;
  /** Resolves once terrain around the last update() camera has streamed in (optional). */
  whenReady?(): Promise<void>;
  /** Swap a ground-target visual to its wrecked state (optional). */
  setGroundTargetDestroyed?(obj: Object3D): void;
  /** Configure sky/sun/fog/clouds for date & weather. */
  setEnvironment(date: string, timeOfDay: TimeOfDay, weather: Weather): void;
  /** Stream terrain tiles and update effects around the camera. */
  update(dt: number, camera: Camera, world: WorldQuery, bullets: readonly BulletView[]): void;
  /** Feed game events to the effects system (explosions, smoke, hits, flak). */
  handleEvent(e: GameEvent): void;
  render(camera: Camera): void;
  resize(width: number, height: number): void;
  /** Visuals for balloons and ground targets. */
  createBalloonVisual(b: BalloonEntity): Object3D;
  createGroundTargetVisual(type: GroundTargetType, side: Side): Object3D;
  dispose(): void;
}

export interface AircraftVisual {
  readonly object: Object3D;
  /** Pilot eye point in body frame (metres), for the cockpit camera. */
  readonly eyePoint: Vector3;
  /** Sync transform, propeller spin, control surfaces, damage decals, smoke emitters. */
  update(ac: AircraftEntity, dt: number): void;
  /** When true: show the 3D cockpit + instruments, hide the pilot head/parts that clip the camera. */
  setCockpitView(enabled: boolean): void;
  dispose(): void;
}

export type AircraftVisualFactory = (spec: AircraftSpec, livery: Livery) => Promise<AircraftVisual>;

// ---------------------------------------------------------------------------
// src/audio
// ---------------------------------------------------------------------------

export type MusicCue = 'menu' | 'briefing' | 'flight' | 'victory' | 'defeat' | 'medal' | 'none';

export interface AudioEngine {
  /** Must be called from a user gesture (browser autoplay policy). */
  resume(): Promise<void>;
  setVolumes(master: number, music: number, effects: number): void;
  playMusic(cue: MusicCue): void;
  playUi(sound: 'click' | 'hover' | 'confirm' | 'back' | 'typewriter' | 'stamp'): void;
  /** Called every frame in flight. listener = active camera. */
  updateFlight(listener: Camera, player: AircraftEntity | null, world: WorldQuery, dt: number, cockpitView: boolean): void;
  handleEvent(e: GameEvent, listenerPos: Vector3): void;
  /** Stop all in-flight loops (engine drones, wind). */
  stopFlight(): void;
}

// ---------------------------------------------------------------------------
// src/campaign
// ---------------------------------------------------------------------------

export interface CampaignService {
  listPilots(): PilotSummary[];
  createPilot(opts: NewPilotOptions): CareerPilot;
  loadPilot(id: string): CareerPilot | null;
  savePilot(p: CareerPilot): void;
  deletePilot(id: string): void;
  /** Squadrons the nation fielded on the date (for pilot creation / transfer). */
  squadronsFor(nation: CareerPilot['nation'], date: string): SquadronInfo[];
  getSquadron(id: string): SquadronInfo | undefined;
  /** Aircraft the pilot's squadron can offer on the current date (first = standard issue). */
  availableAircraft(p: CareerPilot): AircraftId[];
  /** Build the next mission for this pilot. Deterministic for a given pilot state. */
  generateMission(p: CareerPilot, aircraftChoice?: AircraftId): MissionDefinition;
  /** Discharge a pilot from hospital (status -> active). The debrief already advanced the date past the stay. */
  returnToDuty(p: CareerPilot): void;
  /** Apply a result: confirm claims, promotions, medals, wounds, date advance. Mutates & saves p. */
  applyMissionResult(p: CareerPilot, mission: MissionDefinition, result: MissionResult): DebriefReport;
  /** Leaderboard of historical aces + the player on the pilot's current date. */
  aceStandings(p: CareerPilot): AceStanding[];
  /** Quick / single mission builder (not recorded in a career). */
  buildQuickMission(opts: QuickMissionOptions): MissionDefinition;
}

// ---------------------------------------------------------------------------
// src/game — the flight session contract used by the UI
// ---------------------------------------------------------------------------

export interface FlightLauncher {
  /** Mount a flight in the container and resolve with the result when it ends. */
  fly(mission: MissionDefinition, settings: GameSettings, container: HTMLElement): Promise<MissionResult>;
}

/** Service locator handed to UI screens. */
export interface GameServices {
  readonly campaign: CampaignService;
  readonly audio: AudioEngine;
  readonly launcher: FlightLauncher;
  getSettings(): GameSettings;
  saveSettings(s: GameSettings): void;
}
