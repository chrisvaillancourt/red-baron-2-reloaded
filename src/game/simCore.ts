/**
 * SimCore: the headless heart of a flight — world, combat, AI, mission
 * director and the fixed-step update. Shared by the browser FlightSession
 * and the Node autoplayer (src/game/autoplay.ts) so both run identical
 * simulation logic. No DOM, no rendering.
 */
import { createEventBus } from '../core/events';
import type { AIController, CombatSystem, EventBus, WingmanCommand } from '../core/interfaces';
import type { AircraftEntity, MissionDefinition, RealismSettings } from '../core/types';
import { createHeightCache } from './heightCache';
import { MissionDirector } from './missionDirector';
import type { GameModules } from './moduleTypes';
import { buildWorld, type SessionWorld } from './world';

export const SIM_HZ = 120;
export const AI_EVERY_N_STEPS = 4; // 30 Hz

export type SimCoreModules = Pick<
  GameModules,
  'sim' | 'createFlightEnvironment' | 'createCombatSystem' | 'createAIController' | 'terrainHeightAt' | 'sideOfFrontAt'
>;

export interface SimCoreOptions {
  bus?: EventBus;
  /** Fly the player's aircraft with an AI controller too (autoplayer). */
  aiPlayer?: boolean;
}

export class SimCore {
  readonly bus: EventBus;
  readonly world: SessionWorld;
  readonly combat: CombatSystem;
  readonly director: MissionDirector;
  readonly ai = new Map<number, AIController>();
  private stepCount = 0;
  private wasAirborne = new Set<number>();

  constructor(
    private readonly modules: SimCoreModules,
    readonly mission: MissionDefinition,
    private readonly getRealism: () => RealismSettings,
    opts: SimCoreOptions = {},
  ) {
    this.bus = opts.bus ?? createEventBus();
    const realism = getRealism();
    // Sim, AI, combat and cameras all sample the ground through this cache (heightCache.ts).
    const env = modules.createFlightEnvironment(createHeightCache(modules.terrainHeightAt), mission.weather);
    this.world = buildWorld({ mission, modules, env, realism });
    this.combat = modules.createCombatSystem(this.bus, getRealism);
    this.director = new MissionDirector(this.world, this.bus, (from, text) => this.bus.emit({ type: 'radio', from, text }));

    // AI controllers for every non-player aircraft, including pending spawns.
    for (const [flightId, members] of this.world.flightMembers) {
      const flight = this.world.getFlight(flightId)!;
      const leaderId = members[0].id;
      members.forEach((ac, slot) => {
        if (ac.controller !== 'ai' && !(opts.aiPlayer && ac.controller === 'player')) return;
        const homeAerodromeId = flight.role === 'enemy' ? undefined : mission.homeAerodromeId;
        this.ai.set(ac.id, modules.createAIController(ac, { skill: ac.skill, flight, slot, leaderId, realism, homeAerodromeId }));
      });
    }
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
