/** Minimal mock flight world for the audio bench and browser self-test. */
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, AircraftId, DamageZone, Side } from '../../core/types';
import { getAircraft } from '../../data/aircraft';

const ZONES: DamageZone[] = ['engine', 'fuelTank', 'pilot', 'gunner', 'leftWing', 'rightWing', 'tail', 'fuselage', 'controls', 'guns'];

export function mockAircraft(id: number, specId: AircraftId, side: Side): AircraftEntity {
  const spec = getAircraft(specId);
  return {
    id,
    kind: 'aircraft',
    spec,
    side,
    nation: spec.nation,
    livery: { fuselage: '#888', wingTop: '#888', wingBottom: '#aaa', tail: '#888', cowling: '#444', accent: '#c00', insignia: 'roundel-rfc' },
    callsign: `${spec.shortName} #${id}`,
    skill: 'regular',
    flightId: 'f1',
    controller: id === 1 ? 'player' : 'ai',
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false },
    state: {
      position: new Vector3(0, 1500, 0),
      velocity: new Vector3(0, 0, -50),
      orientation: new Quaternion(),
      angularVelocity: new Vector3(),
      airspeed: 50,
      altitude: 1500,
      heightAboveGround: 1450,
      aoa: 0.05,
      sideslip: 0,
      gLoad: 1,
      engineRpm: 1250,
      fuelL: 80,
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

export function mockWorld(aircraft: AircraftEntity[]): WorldQuery & { time: number } {
  return {
    time: 0,
    date: '1917-06-01',
    aircraft,
    balloons: [],
    groundTargets: [],
    getEntity: (id) => aircraft.find((a) => a.id === id),
    groundHeightAt: () => 50,
    sideOfFrontAt: () => 'allied',
    getFlight: () => undefined,
    env: {
      groundHeightAt: () => 50,
      airDensityAt: () => 1.1,
      windAt: (_p, out) => out.set(0, 0, 0),
      turbulence: 0,
    },
  };
}
