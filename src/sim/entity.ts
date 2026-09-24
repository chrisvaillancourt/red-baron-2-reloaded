/** Helpers to build fresh runtime aircraft entities from specs. */
import type {
  AircraftEntity,
  AircraftSpec,
  ControlInputs,
  DamageState,
  FlightEnvironment,
  GunState,
  Livery,
  Nation,
  PilotController,
  SkillLevel,
} from '../core/types';
import { NATION_SIDE } from '../core/types';
import { createFlightState } from './flightModel';

export function createControls(throttle = 0.8): ControlInputs {
  return { pitch: 0, roll: 0, yaw: 0, throttle, blip: false, fireGuns: false, clearJam: false };
}

export function createDamageState(): DamageState {
  return {
    zones: { engine: 0, fuelTank: 0, pilot: 0, gunner: 0, leftWing: 0, rightWing: 0, tail: 0, fuselage: 0, controls: 0, guns: 0 },
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

export function createGunStates(spec: AircraftSpec): GunState[] {
  return spec.guns.map((g, i) => ({
    mountIndex: i,
    roundsLeft: g.rounds,
    sparesLeft: g.spareDrums,
    jammed: false,
    jamClearProgress: 0,
    heat: 0,
    cooldown: 0,
    reloading: 0,
  }));
}

const DEFAULT_LIVERY: Livery = {
  fuselage: '#8a7a5a',
  wingTop: '#7b7a4a',
  wingBottom: '#d8d0b0',
  tail: '#8a7a5a',
  cowling: '#9a9a9a',
  accent: '#444444',
  insignia: 'roundel-rfc',
};

export interface NewAircraftOptions {
  id: number;
  spec: AircraftSpec;
  nation?: Nation;
  livery?: Livery;
  callsign?: string;
  skill?: SkillLevel;
  flightId?: string;
  controller?: PilotController;
  aceId?: string;
  start: { x: number; z: number; altitude: number; heading: number; airspeed: number };
  onGround?: boolean;
  env: FlightEnvironment;
}

/** Build a complete AircraftEntity ready for stepFlight/CombatSystem. */
export function createAircraftEntity(o: NewAircraftOptions): AircraftEntity {
  const nation = o.nation ?? o.spec.nation;
  return {
    id: o.id,
    kind: 'aircraft',
    spec: o.spec,
    side: NATION_SIDE[nation],
    nation,
    livery: o.livery ?? DEFAULT_LIVERY,
    callsign: o.callsign ?? `${o.spec.shortName} #${o.id}`,
    aceId: o.aceId,
    skill: o.skill ?? 'regular',
    flightId: o.flightId ?? 'flight',
    controller: o.controller ?? 'ai',
    controls: createControls(o.onGround ? 0 : 0.8),
    state: createFlightState(o.spec, o.start, o.env, o.onGround ?? false),
    guns: createGunStates(o.spec),
    damage: createDamageState(),
    outcome: null,
  };
}
