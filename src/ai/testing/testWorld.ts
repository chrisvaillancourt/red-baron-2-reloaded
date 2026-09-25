/**
 * Minimal WorldQuery + scenario runner for AI tests (point-mass physics).
 */
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery, AIController } from '../../core/interfaces';
import type {
  AircraftEntity,
  AircraftId,
  BalloonEntity,
  DamageZone,
  Entity,
  FlightEnvironment,
  GroundTargetEntity,
  MissionFlight,
  Weather,
  RealismSettings,
  Side,
  SkillLevel,
} from '../../core/types';
import { getAircraft } from '../../data/aircraft';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { CloudField } from '../../world/clouds';
import { PointMassModel, isaDensity, type ModelVariant } from './pointMassModel';

export const TEST_REALISM: RealismSettings = { ...DEFAULT_SETTINGS.realism };

const ZONES: DamageZone[] = ['engine', 'fuelTank', 'pilot', 'gunner', 'leftWing', 'rightWing', 'tail', 'fuselage', 'controls', 'guns'];

let nextId = 1;

export interface TestAircraftOpts {
  id?: number;
  aircraftId?: AircraftId;
  side: Side;
  x: number;
  z: number;
  alt: number;
  heading: number; // rad
  speed?: number;
  flightId?: string;
  skill?: SkillLevel;
  controller?: 'player' | 'ai' | 'none';
}

export function makeAircraft(o: TestAircraftOpts): AircraftEntity {
  const spec = getAircraft(o.aircraftId ?? (o.side === 'central' ? 'albatros_dv' : 'se5a'));
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -o.heading);
  const speed = o.speed ?? spec.performance.maxSpeedKmh / 3.6 * 0.8;
  const fwd = new Vector3(0, 0, -1).applyQuaternion(orientation);
  return {
    id: o.id ?? nextId++,
    kind: 'aircraft',
    spec,
    side: o.side,
    nation: o.side === 'central' ? 'germany' : 'britain',
    livery: { fuselage: '#888', wingTop: '#888', wingBottom: '#aaa', tail: '#888', cowling: '#444', accent: '#f00', insignia: o.side === 'central' ? 'iron-cross-patee' : 'roundel-rfc' },
    callsign: `${spec.shortName} #${o.id ?? nextId}`,
    skill: o.skill ?? 'regular',
    flightId: o.flightId ?? `${o.side}-1`,
    controller: o.controller ?? 'ai',
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false },
    state: {
      position: new Vector3(o.x, o.alt, o.z),
      velocity: fwd.multiplyScalar(speed),
      orientation,
      angularVelocity: new Vector3(),
      airspeed: speed,
      altitude: o.alt,
      heightAboveGround: o.alt,
      aoa: 0.05,
      sideslip: 0,
      gLoad: 1,
      engineRpm: 1200,
      fuelL: spec.performance.fuelCapacityL,
      onGround: false,
      stalled: false,
    },
    guns: spec.guns.map((g, i) => ({ mountIndex: i, roundsLeft: g.rounds, sparesLeft: g.spareDrums, jammed: false, jamClearProgress: 0, heat: 0, cooldown: 0, reloading: 0 })),
    damage: {
      zones: Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<DamageZone, number>,
      onFire: false,
      smoking: false,
      fuelLeak: false,
      engineDead: false,
      pilotWounded: false,
      pilotKilled: false,
      structuralFailure: false,
      destroyed: false,
      lastAttackerId: null,
    },
    outcome: null,
  };
}

export interface TestWorldOpts {
  ground?: (x: number, z: number) => number;
  /** x > frontX is central territory. */
  frontX?: number;
  flights?: MissionFlight[];
  date?: string;
  /** Sun for glare and up-sun tactics, e.g. `sunDirectionFor(date, 'morning')`. Default: none. */
  sunDirection?: Vector3;
  /** Weather; its clouds become `cloudDensityAt` / `cloudTransmittance`. Default: none (clear). */
  weather?: Weather;
}

export class TestWorld implements WorldQuery {
  time = 0;
  date: string;
  readonly sunDirection?: Vector3;
  readonly weather?: Weather;
  readonly cloudDensityAt?: (x: number, y: number, z: number) => number;
  readonly cloudTransmittance?: (from: Vector3, to: Vector3) => number;
  readonly nearestCloud?: (p: Vector3, maxR: number) => { position: Vector3; radius: number } | null;
  aircraft: AircraftEntity[] = [];
  balloons: BalloonEntity[] = [];
  groundTargets: GroundTargetEntity[] = [];
  env: FlightEnvironment;
  private flights = new Map<string, MissionFlight>();
  private ground: (x: number, z: number) => number;
  private frontX: number;

  constructor(o: TestWorldOpts = {}) {
    this.ground = o.ground ?? (() => 50);
    this.frontX = o.frontX ?? 0;
    this.date = o.date ?? '1917-09-01';
    this.sunDirection = o.sunDirection;
    if (o.weather) {
      const clouds = new CloudField(o.weather);
      this.weather = o.weather;
      this.cloudDensityAt = (x, y, z) => clouds.densityAt(x, y, z, this.time);
      this.cloudTransmittance = (a, b) => clouds.transmittance(a.x, a.y, a.z, b.x, b.y, b.z, this.time);
      this.nearestCloud = (p, maxR) => {
        const c = clouds.nearestCloud(p.x, p.y, p.z, this.time, maxR);
        return c ? { position: new Vector3(c.x, c.y, c.z), radius: c.radius } : null;
      };
    }
    for (const f of o.flights ?? []) this.flights.set(f.id, f);
    this.env = {
      groundHeightAt: (x, z) => this.ground(x, z),
      airDensityAt: isaDensity,
      windAt: (_p, out) => out.set(0, 0, 0),
      turbulence: 0,
    };
  }
  addFlight(f: MissionFlight): void {
    this.flights.set(f.id, f);
  }
  getEntity(id: number): Entity | undefined {
    return this.aircraft.find((a) => a.id === id) ?? this.balloons.find((b) => b.id === id) ?? this.groundTargets.find((g) => g.id === id);
  }
  groundHeightAt(x: number, z: number): number {
    return this.ground(x, z);
  }
  sideOfFrontAt(x: number, _z: number): Side {
    return x > this.frontX ? 'central' : 'allied';
  }
  getFlight(id: string): MissionFlight | undefined {
    return this.flights.get(id);
  }
}

export interface ScenarioHooks {
  /** Called each physics step after AI + physics. Return true to stop. */
  onStep?: (t: number) => boolean | void;
  /** Controllers for scripted (non-AI) aircraft: write controls. */
  scripted?: Map<number, (ac: AircraftEntity, dt: number) => void>;
  /** Flight-model variation applied to every aircraft. */
  variant?: ModelVariant;
  /** AI update interval in physics steps (default 4 = 30 Hz). */
  aiEvery?: number;
}

/** Run AI at 30 Hz and point-mass physics at 120 Hz for `seconds`. */
export function runScenario(world: TestWorld, controllers: Map<number, AIController>, seconds: number, hooks: ScenarioHooks = {}): void {
  const models = new Map<number, PointMassModel>();
  for (const ac of world.aircraft) models.set(ac.id, new PointMassModel(ac.spec, hooks.variant));
  const dt = 1 / 120;
  const aiEvery = hooks.aiEvery ?? 4;
  let step = 0;
  while (world.time < seconds) {
    if (step % aiEvery === 0) {
      for (const ac of world.aircraft) {
        if (ac.outcome) continue;
        const ctl = controllers.get(ac.id);
        if (ctl) ctl.update(ac, world, dt * aiEvery);
        hooks.scripted?.get(ac.id)?.(ac, dt * aiEvery);
      }
    }
    for (const ac of world.aircraft) models.get(ac.id)!.step(ac, world.env, dt);
    world.time += dt;
    step++;
    if (hooks.onStep?.(world.time)) break;
  }
}
