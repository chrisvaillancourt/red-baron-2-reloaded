/**
 * Session world: builds entities from a MissionDefinition and implements
 * WorldQuery for AI, combat, HUD and the mission director.
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type {
  AircraftEntity,
  BalloonEntity,
  ControlInputs,
  DamageState,
  Entity,
  FlightEnvironment,
  GroundTargetEntity,
  GunState,
  MissionDefinition,
  MissionFlight,
  RealismSettings,
  Side,
} from '../core/types';
import { NATION_SIDE } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { CloudField } from '../world/clouds';
import { sunDirectionFor } from '../world/sun';
import type { GameModules } from './moduleTypes';

export interface PendingSpawn {
  ac: AircraftEntity;
  spawnAt: number;
}

export interface SessionWorld extends WorldQuery {
  time: number;
  readonly aircraft: AircraftEntity[];
  readonly balloons: BalloonEntity[];
  readonly groundTargets: GroundTargetEntity[];
  readonly pending: PendingSpawn[];
  readonly mission: MissionDefinition;
  player: AircraftEntity | null;
  /** All aircraft of a flight, spawned or pending, in slot order. */
  readonly flightMembers: Map<string, AircraftEntity[]>;
  /** Mission-level ids (balloon/ground target ids) -> entity ids. */
  readonly missionIdToEntity: Map<string, number>;
  /** Move pending spawns whose time has come into the live list. Returns newly spawned. */
  spawnDue(): AircraftEntity[];
  /** Every aircraft, spawned or not. */
  allAircraft(): AircraftEntity[];
}

export function emptyControls(throttle = 0): ControlInputs {
  return { pitch: 0, roll: 0, yaw: 0, throttle, blip: false, fireGuns: false, clearJam: false };
}

export function createDamageState(): DamageState {
  return {
    zones: {
      engine: 0,
      fuelTank: 0,
      pilot: 0,
      gunner: 0,
      leftWing: 0,
      rightWing: 0,
      tail: 0,
      fuselage: 0,
      controls: 0,
      guns: 0,
    },
    onFire: false,
    smoking: false,
    fuelLeak: false,
    engineDead: false,
    pilotWounded: false,
    pilotKilled: false,
    structuralFailure: false,
    destroyed: false,
    lastAttackerId: null,
  };
}

export function createGunStates(ac: Pick<AircraftEntity, 'spec'>, realism: RealismSettings): GunState[] {
  return ac.spec.guns.map((m, i) => ({
    mountIndex: i,
    roundsLeft: realism.limitedAmmo ? m.rounds : Number.POSITIVE_INFINITY,
    sparesLeft: realism.limitedAmmo ? m.spareDrums : Number.POSITIVE_INFINITY,
    jammed: false,
    jamClearProgress: 0,
    heat: 0,
    cooldown: 0,
    reloading: 0,
  }));
}

/**
 * Formation slot offsets in the leader's frame (right, up, back), metres.
 * Slot 0 is the leader; then a loose vic/echelon as flown in 1917-18.
 */
export function formationOffset(slot: number): { right: number; up: number; back: number } {
  if (slot === 0) return { right: 0, up: 0, back: 0 };
  const rank = Math.ceil(slot / 2);
  const side = slot % 2 === 1 ? 1 : -1;
  return { right: side * 45 * rank, up: 8 * rank, back: 40 * rank };
}

export interface BuildWorldOptions {
  mission: MissionDefinition;
  modules: Pick<GameModules, 'sim' | 'sideOfFrontAt'>;
  env: FlightEnvironment;
  realism: RealismSettings;
}

export function buildWorld(opts: BuildWorldOptions): SessionWorld {
  const { mission, modules, env, realism } = opts;
  let nextId = 1;
  const aircraft: AircraftEntity[] = [];
  const balloons: BalloonEntity[] = [];
  const groundTargets: GroundTargetEntity[] = [];
  const pending: PendingSpawn[] = [];
  const flightMembers = new Map<string, AircraftEntity[]>();
  const flights = new Map<string, MissionFlight>();
  const missionIdToEntity = new Map<string, number>();
  const byId = new Map<number, Entity>();
  let player: AircraftEntity | null = null;

  for (const flight of mission.flights) {
    flights.set(flight.id, flight);
    const spec = getAircraft(flight.aircraftId);
    const side: Side = flight.side ?? NATION_SIDE[flight.nation];
    const members: AircraftEntity[] = [];
    const heading = flight.start.heading;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    flight.members.forEach((m, slot) => {
      // Heading h: forward = (sin h, -cos h), right = (cos h, sin h) in (x, z).
      let dx: number, dz: number, dy: number;
      if (flight.startOnGround) {
        const back = slot * 45;
        const right = slot % 2 === 1 ? 20 : slot === 0 ? 0 : -20;
        dx = cosH * right - sinH * back;
        dz = sinH * right + cosH * back;
        dy = 0;
      } else {
        const o = formationOffset(slot);
        dx = cosH * o.right - sinH * o.back;
        dz = sinH * o.right + cosH * o.back;
        dy = o.up;
      }
      const start = {
        x: flight.start.x + dx,
        z: flight.start.z + dz,
        altitude: flight.start.altitude + dy,
        heading,
        airspeed: flight.startOnGround ? 0 : flight.start.airspeed,
      };
      const id = nextId++;
      const ac: AircraftEntity = {
        id,
        kind: 'aircraft',
        spec,
        side,
        nation: flight.nation,
        livery: m.livery,
        callsign: m.pilotName ?? `${spec.shortName} #${slot + 1}`,
        aceId: m.aceId,
        skill: m.skill,
        flightId: flight.id,
        controller: m.isPlayer ? 'player' : 'ai',
        controls: emptyControls(flight.startOnGround ? 0 : 0.85),
        state: modules.sim.createFlightState(spec, start, env, !!flight.startOnGround),
        guns: [],
        damage: createDamageState(),
        outcome: null,
      };
      ac.guns = createGunStates(ac, realism);
      if (m.isPlayer) player = ac;
      members.push(ac);
      byId.set(id, ac);
      const delay = flight.spawnDelay ?? 0;
      if (delay > 0 && !m.isPlayer) pending.push({ ac, spawnAt: delay });
      else aircraft.push(ac);
    });
    flightMembers.set(flight.id, members);
  }

  for (const b of mission.balloons) {
    const gh = env.groundHeightAt(b.x, b.z);
    const e: BalloonEntity = {
      id: nextId++,
      kind: 'balloon',
      side: b.side,
      position: new Vector3(b.x, gh + b.altitude, b.z),
      anchor: new Vector3(b.x, gh, b.z),
      health: 1,
      burning: false,
      destroyed: false,
      observerBailed: false,
    };
    balloons.push(e);
    byId.set(e.id, e);
    missionIdToEntity.set(b.id, e.id);
  }

  for (const g of mission.groundTargets) {
    const e: GroundTargetEntity = {
      id: nextId++,
      kind: 'ground',
      type: g.type,
      side: g.side,
      position: new Vector3(g.x, env.groundHeightAt(g.x, g.z), g.z),
      heading: g.heading,
      health: 1,
      destroyed: false,
    };
    groundTargets.push(e);
    byId.set(e.id, e);
    missionIdToEntity.set(g.id, e.id);
  }

  // The AI's sun and clouds: the same sources the renderer draws from.
  const clouds = new CloudField(mission.weather);
  const world: SessionWorld = {
    time: 0,
    date: mission.date,
    sunDirection: sunDirectionFor(mission.date, mission.timeOfDay),
    weather: mission.weather,
    cloudDensityAt: (x, y, z) => clouds.densityAt(x, y, z, world.time),
    cloudTransmittance: (a, b) => clouds.transmittance(a.x, a.y, a.z, b.x, b.y, b.z, world.time),
    aircraft,
    balloons,
    groundTargets,
    pending,
    mission,
    player,
    flightMembers,
    missionIdToEntity,
    env,
    getEntity: (id) => byId.get(id),
    groundHeightAt: (x, z) => env.groundHeightAt(x, z),
    sideOfFrontAt: (x, z) => modules.sideOfFrontAt(x, z, mission.date),
    getFlight: (id) => flights.get(id),
    spawnDue() {
      const out: AircraftEntity[] = [];
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].spawnAt <= world.time) {
          out.push(pending[i].ac);
          aircraft.push(pending[i].ac);
          pending.splice(i, 1);
        }
      }
      return out;
    },
    allAircraft: () => [...flightMembers.values()].flat(),
  };
  return world;
}
