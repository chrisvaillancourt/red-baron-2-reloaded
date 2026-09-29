/**
 * SimCore: the headless heart of a flight — world, combat, AI, mission
 * director and the fixed-step update. Shared by the browser FlightSession
 * and the Node autoplayer (src/game/autoplay.ts) so both run identical
 * simulation logic. No DOM, no rendering.
 */
import { Vector3 } from 'three';
import { createEventBus } from '../core/events';
import type { AIController, CombatSystem, EventBus, WingmanCommand, WorldQuery } from '../core/interfaces';
import type { AircraftEntity, CrewStationId, MissionDefinition, MissionFlight, RealismSettings } from '../core/types';
import type { HumanPilotParams } from '../ai/humanAim';
import { aimBodyVector, stationInputsFor, stationOf, startStation, StationAim } from './crewSeat';
import { createHeightCache } from './heightCache';
import { MissionDirector } from './missionDirector';
import type { GameModules } from './moduleTypes';
import { buildWorld, type SessionWorld } from './world';

export const SIM_HZ = 120;
export const AI_EVERY_N_STEPS = 4; // 30 Hz

export type SimCoreModules = Pick<
  GameModules,
  'sim' | 'createFlightEnvironment' | 'createCombatSystem' | 'createAIController' | 'terrainHeightAt' | 'sideOfFrontAt'
> &
  /** Resets the player's gunner to his own targeting when the player gives the AI pilot back the aircraft. */
  Partial<Pick<GameModules, 'setGunnerTarget'>>;

export interface SimCoreOptions {
  bus?: EventBus;
  /** Fly the player's aircraft with an AI controller too (autoplayer). */
  aiPlayer?: boolean;
  /** With aiPlayer: that controller aims and fires like a human (src/ai/humanAim.ts). */
  humanPlayer?: HumanPilotParams;
}

export class SimCore {
  readonly bus: EventBus;
  readonly world: SessionWorld;
  readonly combat: CombatSystem;
  readonly director: MissionDirector;
  readonly ai = new Map<number, AIController>();
  private stepCount = 0;
  private wasAirborne = new Set<number>();
  private readonly aiPlayer: boolean;
  private station: CrewStationId = 'pilot';
  /** The director recalled the player's flight: an AI pilot taking over later heads home too. */
  private recalled = false;

  constructor(
    private readonly modules: SimCoreModules,
    readonly mission: MissionDefinition,
    private readonly getRealism: () => RealismSettings,
    opts: SimCoreOptions = {},
  ) {
    this.bus = opts.bus ?? createEventBus();
    this.aiPlayer = !!opts.aiPlayer;
    const realism = getRealism();
    // Sim, AI, combat and cameras all sample the ground through this cache (heightCache.ts).
    const env = modules.createFlightEnvironment(createHeightCache(modules.terrainHeightAt), mission.weather);
    this.world = buildWorld({ mission, modules, env, realism });
    this.combat = modules.createCombatSystem(this.bus, getRealism);
    this.director = new MissionDirector(this.world, this.bus, (from, text) => this.bus.emit({ type: 'radio', from, text }), {
      // Job settled (escort home or lost, intercept done): the flight goes home. An AI-flown
      // player (autoplayer) is ordered home too; a human is told so over the radio.
      onRecall: () => {
        this.recalled = true;
        this.orderWingmen('return-home');
        const p = this.world.player;
        if (p) this.ai.get(p.id)?.command('return-home');
      },
    });

    // AI controllers for every non-player aircraft, including pending spawns.
    for (const [flightId, members] of this.world.flightMembers) {
      const flight = this.world.getFlight(flightId)!;
      const leaderId = members[0].id;
      members.forEach((ac, slot) => {
        if (ac.controller !== 'ai' && !(opts.aiPlayer && ac.controller === 'player')) return;
        const homeAerodromeId = flight.role === 'enemy' ? undefined : mission.homeAerodromeId;
        const human = ac.controller === 'player' ? opts.humanPlayer : undefined;
        this.ai.set(ac.id, modules.createAIController(ac, { skill: ac.skill, flight, slot, leaderId, realism, homeAerodromeId, ...(human ? { human } : {}) }));
      });
    }

    // A human starting at a gunner's or bomb aimer's station (the autoplayer flies and guns everything).
    const p = this.world.player;
    const requested = p ? mission.flights.flatMap((f) => f.members).find((m) => m.isPlayer)?.station : undefined;
    if (p && !this.aiPlayer && requested) this.setPlayerStation(startStation(p.spec, requested));
  }

  /** The crew station the player works: 'pilot' unless he has taken another. */
  get playerStation(): CrewStationId {
    return this.station;
  }

  /**
   * Put the player at a crew station of his aircraft (D-089, docs/bombers.md). At any station
   * but the pilot's an AI pilot flies the aircraft, taking up the route at `fromWaypoint` (the
   * player's next waypoint), and `stationInputs` carry the player's aim and buttons; the
   * aircraft keeps `controller: 'player'`. Back at the pilot's seat the AI pilot is dropped and
   * the controls are the player's again. False when there is no live player or the type has
   * no such station.
   */
  setPlayerStation(station: CrewStationId, opts: { fromWaypoint?: number } = {}): boolean {
    const p = this.world.player;
    if (!p || p.outcome !== null) return false;
    const st = stationOf(p.spec, station);
    if (!st) return false;
    this.station = station;
    if (station === 'pilot') {
      p.stationInputs = undefined;
      if (!this.aiPlayer && this.ai.delete(p.id)) this.modules.setGunnerTarget?.(p, null);
      return true;
    }
    if (!this.ai.has(p.id)) this.ai.set(p.id, this.createPlayerPilot(p, opts.fromWaypoint ?? 0));
    const aim = new StationAim(st.arcs);
    p.stationInputs = stationInputsFor(st, aimBodyVector(aim.azimuthDeg, aim.elevationDeg, new Vector3()), p.state.orientation, { fire: false, releaseBomb: false, clearJam: false }, p.stationInputs);
    return true;
  }

  /**
   * An AI pilot for the player's aircraft while he works a gun. It flies the flight's own task
   * (the autoplayer's options), but sees the route from the player's next waypoint on, so a
   * pilot taking over mid-mission doesn't turn back for waypoints already flown.
   */
  private createPlayerPilot(p: AircraftEntity, fromWaypoint: number): AIController {
    const flight = this.world.getFlight(p.flightId)!;
    const from = Math.max(0, Math.min(fromWaypoint, flight.waypoints.length - 1));
    const route: MissionFlight = from > 0 ? { ...flight, waypoints: flight.waypoints.slice(from) } : flight;
    const members = this.world.flightMembers.get(p.flightId) ?? [p];
    const homeAerodromeId = flight.role === 'enemy' ? undefined : this.mission.homeAerodromeId;
    const inner = this.modules.createAIController(p, { skill: p.skill, flight: route, slot: Math.max(0, members.indexOf(p)), leaderId: members[0].id, realism: this.getRealism(), homeAerodromeId });
    if (this.recalled) inner.command('return-home');
    if (route === flight) return inner;
    const world = this.world;
    const view: WorldQuery = Object.create(world, { getFlight: { value: (id: string) => (id === p.flightId ? route : world.getFlight(id)) } });
    return {
      entityId: inner.entityId,
      update: (self, _w, dt) => inner.update(self, view, dt),
      command: (cmd, targetId) => inner.command(cmd, targetId),
      get debugState() {
        return inner.debugState;
      },
    };
  }

  /** One fixed simulation step of `h` seconds. Returns aircraft that spawned this step. */
  step(h: number): AircraftEntity[] {
    const world = this.world;
    const realism = this.getRealism();
    world.time += h;
    const spawned = world.spawnDue();
    const runAi = this.stepCount % AI_EVERY_N_STEPS === 0;
    this.stepCount++;
    if (runAi) {
      for (const ac of world.aircraft) {
        if (ac.outcome !== null) continue;
        this.ai.get(ac.id)?.update(ac, world, h * AI_EVERY_N_STEPS);
      }
    }
    for (const ac of world.aircraft) {
      if (ac.outcome !== null && ac.state.onGround) continue;
      if (ac.outcome === 'disengaged') continue;
      this.modules.sim.stepFlight(ac, world.env, realism, h);
      this.detectLanding(ac);
    }
    this.combat.update(world, h);
    this.director.update(h);
    return spawned;
  }

  private detectLanding(ac: AircraftEntity): void {
    const s = ac.state;
    if (!s.onGround) {
      if (s.heightAboveGround > 5) this.wasAirborne.add(ac.id);
      return;
    }
    // Ground speed, not airspeed: in any wind a stopped aircraft still shows airspeed.
    if (ac.outcome !== null || !this.wasAirborne.has(ac.id) || s.velocity.length() > 2) return;
    const friendly = this.world.sideOfFrontAt(s.position.x, s.position.z) === ac.side;
    ac.outcome = friendly ? 'landed-friendly' : 'landed-enemy';
    this.bus.emit({ type: 'aircraft-landed', aircraftId: ac.id, friendlyTerritory: friendly });
  }

  /** Live wingmen of the player (flight mates), in slot order. */
  playerWingmen(): AircraftEntity[] {
    const p = this.world.player;
    if (!p) return [];
    return (this.world.flightMembers.get(p.flightId) ?? []).filter((a) => a.id !== p.id && a.outcome === null);
  }

  /** Issue a wingman order to every live flight mate. Returns the mates ordered. */
  orderWingmen(cmd: WingmanCommand, targetId?: number): AircraftEntity[] {
    const mates = this.playerWingmen();
    for (const m of mates) this.ai.get(m.id)?.command(cmd, targetId);
    return mates;
  }

  dispose(): void {
    this.director.dispose();
  }
}
