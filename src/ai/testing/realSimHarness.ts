/**
 * Headless scenario harness on the REAL flight model and combat system:
 * sim.stepFlight at 120 Hz, createCombatSystem, AI at 30 Hz, a WorldQuery
 * over flat/stub terrain and a simple or real front line, plus an event log.
 *
 * Used by the *.realsim.test.ts scenario tests and for tuning runs.
 */
import { Vector3 } from 'three';
import type { AIController, WorldQuery } from '../../core/interfaces';
import type {
  AircraftEntity,
  AircraftId,
  BalloonEntity,
  Entity,
  GameEvent,
  GroundTargetEntity,
  GroundTargetType,
  MissionFlight,
  Nation,
  RealismSettings,
  Side,
  SkillLevel,
} from '../../core/types';
import { createEventBus } from '../../core/events';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { getAircraft } from '../../data/aircraft';
import {
  createAircraftEntity,
  createCombatSystem,
  createFlightEnvironment,
  createRng,
  getSimInternal,
  isStoppedOnGround,
  setGunnerTarget,
  SIM_DT,
  stepFlight,
  type SimCombatSystem,
  type SimFlightEnvironment,
} from '../../sim';
import { sideOfFrontAt } from '../../world/frontline';
import { createAIController, type AIControllerOptions, type AIPilot } from '../controller';

export const STANDARD_REALISM: RealismSettings = { ...DEFAULT_SETTINGS.realism, flightModel: 'standard', engineTorque: true };

export interface SimWorldOpts {
  ground?: (x: number, z: number) => number;
  /** x > frontX is central territory. Ignored when `realFront` is set. */
  frontX?: number;
  /** Use src/world/frontline sideOfFrontAt for the date. */
  realFront?: boolean;
  flights?: MissionFlight[];
  date?: string;
  realism?: RealismSettings;
  /** Enable archie / small-arms ground fire (default off for determinism). */
  flak?: boolean;
  groundFire?: boolean;
  seed?: number;
}

export interface SimAircraftOpts {
  id?: number;
  aircraftId?: AircraftId;
  side: Side;
  nation?: Nation;
  x: number;
  z: number;
  alt: number;
  heading: number; // rad, clockwise from north
  speed?: number;
  flightId?: string;
  skill?: SkillLevel;
  controller?: 'player' | 'ai' | 'none';
  onGround?: boolean;
}

export class SimWorld implements WorldQuery {
  time = 0;
  date: string;
  aircraft: AircraftEntity[] = [];
  balloons: BalloonEntity[] = [];
  groundTargets: GroundTargetEntity[] = [];
  readonly env: SimFlightEnvironment;
  readonly realism: RealismSettings;
  readonly events: GameEvent[] = [];
  readonly combat: SimCombatSystem;
  readonly controllers = new Map<number, AIPilot>();
  private readonly flights = new Map<string, MissionFlight>();
  private readonly ground: (x: number, z: number) => number;
  private readonly frontX: number;
  private readonly realFront: boolean;
  private nextId = 1;
  /** Aircraft that have been airborne (so a later stop on the ground is a landing). */
  private readonly flown = new Set<number>();

  constructor(o: SimWorldOpts = {}) {
    this.ground = o.ground ?? (() => 50);
    this.frontX = o.frontX ?? 0;
    this.realFront = o.realFront ?? false;
    this.date = o.date ?? '1917-09-01';
    this.realism = o.realism ?? STANDARD_REALISM;
    for (const f of o.flights ?? []) this.flights.set(f.id, f);
    this.env = createFlightEnvironment((x, z) => this.ground(x, z), { wind: [0, 0, 0], turbulence: 0 });
    const bus = createEventBus();
    bus.onAny((e) => this.events.push(e));
    this.combat = createCombatSystem(bus, () => this.realism, { flak: o.flak ?? false, groundFire: o.groundFire ?? false, rng: createRng(o.seed ?? 1) });
  }

  addFlight(f: MissionFlight): void {
    this.flights.set(f.id, f);
  }
  getFlight(id: string): MissionFlight | undefined {
    return this.flights.get(id);
  }
  getEntity(id: number): Entity | undefined {
    return this.aircraft.find((a) => a.id === id) ?? this.balloons.find((b) => b.id === id) ?? this.groundTargets.find((g) => g.id === id);
  }
  groundHeightAt(x: number, z: number): number {
    return this.ground(x, z);
  }
  sideOfFrontAt(x: number, z: number): Side {
    if (this.realFront) return sideOfFrontAt(x, z, this.date);
    return x > this.frontX ? 'central' : 'allied';
  }

  addAircraft(o: SimAircraftOpts): AircraftEntity {
    const spec = getAircraft(o.aircraftId ?? (o.side === 'central' ? 'albatros_dv' : 'se5a'));
    const nation: Nation = o.nation ?? (o.side === 'central' ? 'germany' : spec.nation === 'germany' ? 'britain' : spec.nation);
    const id = o.id ?? this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    const speed = o.speed ?? (o.onGround ? 0 : (spec.performance.maxSpeedKmh / 3.6) * 0.8);
    const ac = createAircraftEntity({
      id,
      spec,
      nation,
      skill: o.skill ?? 'regular',
      flightId: o.flightId ?? `${o.side}-1`,
      controller: o.controller ?? 'ai',
      env: this.env,
      onGround: o.onGround,
      start: { x: o.x, z: o.z, altitude: o.alt, heading: o.heading, airspeed: speed },
    });
    this.aircraft.push(ac);
    return ac;
  }

  /** Create and register an AI controller for `ac` (gunner hook wired to the real combat). */
  addAI(ac: AircraftEntity, skill: SkillLevel, extra: Partial<AIControllerOptions> = {}): AIPilot {
    const ctl = createAIController(ac, {
      role: ac.side === 'allied' ? 'friendly' : 'enemy',
      task: 'fighter-sweep',
      skill,
      realism: this.realism,
      setGunnerTarget,
      ...extra,
    });
    this.controllers.set(ac.id, ctl);
    return ctl;
  }

  addBalloon(side: Side, x: number, z: number, agl = 800): BalloonEntity {
    const gy = this.ground(x, z);
    const b: BalloonEntity = {
      id: this.nextId++,
      kind: 'balloon',
      side,
      position: new Vector3(x, gy + agl, z),
      anchor: new Vector3(x, gy, z),
      health: 1,
      burning: false,
      destroyed: false,
      observerBailed: false,
    };
    this.balloons.push(b);
    return b;
  }

  addGroundTarget(type: GroundTargetType, side: Side, x: number, z: number): GroundTargetEntity {
    const g: GroundTargetEntity = {
      id: this.nextId++,
      kind: 'ground',
      type,
      side,
      position: new Vector3(x, this.ground(x, z), z),
      heading: 0,
      health: 1,
      destroyed: false,
    };
    this.groundTargets.push(g);
    return g;
  }

  eventsOf<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
  }

  /** One fixed physics step; AI runs when `runAi` is set. */
  step(runAi: boolean, aiDt: number, scripted?: Map<number, (ac: AircraftEntity, dt: number) => void>): void {
    if (runAi) {
      for (const ac of this.aircraft) {
        if (ac.outcome) continue;
        this.controllers.get(ac.id)?.update(ac, this, aiDt);
        scripted?.get(ac.id)?.(ac, aiDt);
      }
    }
    for (const ac of this.aircraft) {
      // Wrecks keep falling until they hit the ground; landed aircraft stay put.
      if (getSimInternal(ac).impacted || ac.outcome === 'landed-friendly' || ac.outcome === 'landed-enemy') continue;
      stepFlight(ac, this.env, this.realism, SIM_DT);
      if (!ac.state.onGround && ac.state.heightAboveGround > 5) this.flown.add(ac.id);
    }
    this.combat.update(this, SIM_DT);
    this.env.advance(SIM_DT);
    this.time += SIM_DT;
    // Session bookkeeping the sim leaves to us: landings.
    for (const ac of this.aircraft) {
      if (ac.outcome || !this.flown.has(ac.id)) continue;
      const ctl = this.controllers.get(ac.id);
      if ((ctl && ctl.phase === 'landed') || isStoppedOnGround(ac)) {
        const friendly = this.sideOfFrontAt(ac.state.position.x, ac.state.position.z) === ac.side;
        ac.outcome = friendly ? 'landed-friendly' : 'landed-enemy';
      }
    }
  }
}

export interface RunHooks {
  /** Called each physics step. Return true to stop. */
  onStep?: (t: number) => boolean | void;
  scripted?: Map<number, (ac: AircraftEntity, dt: number) => void>;
  /** AI update interval in physics steps (default 4 = 30 Hz). */
  aiEvery?: number;
}

/** Run the world for `seconds` of mission time (or until onStep returns true). */
export function runSim(world: SimWorld, seconds: number, hooks: RunHooks = {}): void {
  const aiEvery = hooks.aiEvery ?? 4;
  let step = 0;
  const end = world.time + seconds;
  while (world.time < end) {
    world.step(step % aiEvery === 0, SIM_DT * aiEvery, hooks.scripted);
    step++;
    if (hooks.onStep?.(world.time)) break;
  }
}

/** Convenience: a controller map for code that wants the AIController interface. */
export function controllerMap(world: SimWorld): Map<number, AIController> {
  return world.controllers as Map<number, AIController>;
}

/** Summary of an aircraft for tuning logs. */
export function describe(ac: AircraftEntity, ctl?: AIPilot): string {
  const s = ac.state;
  return `${ac.spec.shortName}#${ac.id} ${ac.outcome ?? 'flying'} alt=${s.altitude.toFixed(0)} agl=${s.heightAboveGround.toFixed(0)} v=${s.airspeed.toFixed(1)} g=${s.gLoad.toFixed(2)} ${ctl?.debugState ?? ''}`;
}
