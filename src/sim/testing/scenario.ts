/**
 * A small combat world for sim tests (not used at runtime): real combat, a flat 50 m
 * ground, optional autopilot flight, and an event log. Tests import it rather than
 * copying the setup; never import helpers from a `*.test.ts` file (CLAUDE.md).
 */
import { Vector3 } from 'three';
import type { WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, AircraftId, AircraftSpec, BalloonEntity, GameEvent, GroundTargetEntity, RealismSettings } from '../../core/types';
import { createEventBus } from '../../core/events';
import { getAircraft } from '../../data/aircraft';
import { createFlightEnvironment } from '../atmosphere';
import { Autopilot } from '../autopilot';
import { createCombatSystem } from '../combat';
import { createAircraftEntity } from '../entity';
import { SIM_DT, orientationFrom, stepFlight } from '../flightModel';
import { createRng } from '../rng';
import { flatEnv, realism } from '../testUtil';

export interface ScenarioOptions {
  realism?: Partial<RealismSettings>;
  flak?: boolean;
  groundFire?: boolean;
  sideOfFront?: (x: number) => 'allied' | 'central';
  /** Ground height, m (default 50). */
  groundH?: number;
  wind?: [number, number, number];
  seed?: number;
}

export function scenario(opts: ScenarioOptions = {}) {
  const groundH = opts.groundH ?? 50;
  const env = opts.wind ? flatEnvWind(groundH, opts.wind) : flatEnv(groundH);
  const bus = createEventBus();
  const events: GameEvent[] = [];
  bus.onAny((e) => events.push(e));
  const r = realism(opts.realism);
  const combat = createCombatSystem(bus, () => r, { rng: createRng(opts.seed ?? 42), flak: opts.flak ?? false, groundFire: opts.groundFire ?? false });
  const aircraft: AircraftEntity[] = [];
  const balloons: BalloonEntity[] = [];
  const groundTargets: GroundTargetEntity[] = [];
  const side = opts.sideOfFront ?? (() => 'allied');
  const world: WorldQuery & { time: number } = {
    time: 0,
    date: '1917-06-01',
    aircraft,
    balloons,
    groundTargets,
    getEntity: (id) => aircraft.find((a) => a.id === id) ?? balloons.find((b) => b.id === id) ?? groundTargets.find((g) => g.id === id),
    groundHeightAt: () => groundH,
    sideOfFrontAt: (x) => side(x),
    getFlight: () => undefined,
    env,
  };
  const add = (id: number, type: AircraftId | AircraftSpec, x: number, z: number, alt: number, heading = 0, nation?: AircraftEntity['nation']) => {
    const spec = typeof type === 'string' ? getAircraft(type) : type;
    const ac = createAircraftEntity({ id, spec, env, nation, start: { x, z, altitude: alt, heading, airspeed: 45 } });
    aircraft.push(ac);
    return ac;
  };
  const addGround = (id: number, type: GroundTargetEntity['type'], x: number, z: number, targetSide: GroundTargetEntity['side'] = 'central') => {
    const gt: GroundTargetEntity = { id, kind: 'ground', type, side: targetSide, position: new Vector3(x, groundH, z), heading: 0, health: 1, destroyed: false };
    groundTargets.push(gt);
    return gt;
  };
  const autopilots = new Map<number, Autopilot>();
  /** Advance `seconds`; `fly`: true = autopilot + flight model, 'kinematic' = straight lines, false = frozen. */
  const step = (seconds: number, each?: () => void, fly: boolean | 'kinematic' = true) => {
    for (let t = 0; t < seconds; t += SIM_DT) {
      each?.();
      if (fly === 'kinematic') {
        for (const ac of aircraft) if (!ac.damage.destroyed) ac.state.position.addScaledVector(ac.state.velocity, SIM_DT);
      } else if (fly) {
        for (const ac of aircraft) {
          if (ac.controller !== 'none') {
            let ap = autopilots.get(ac.id);
            if (!ap) autopilots.set(ac.id, (ap = new Autopilot()));
            const fire = ac.controls.fireGuns;
            if (!ac.damage.destroyed) ap.update(ac, { altitude: 1000, heading: 0, throttle: 0.9 }, SIM_DT);
            ac.controls.fireGuns = fire;
          }
          stepFlight(ac, env, r, SIM_DT);
        }
      }
      combat.update(world, SIM_DT);
      env.advance(SIM_DT);
      world.time += SIM_DT;
    }
  };
  return { env, bus, events, combat, world, aircraft, balloons, groundTargets, add, addGround, step, r };
}

export type Scenario = ReturnType<typeof scenario>;

const flatEnvWind = (h: number, wind: [number, number, number]) => createFlightEnvironment(() => h, { wind, turbulence: 0 });

/** Point the shooter's sight line (eye 0.8 m above CG) at the target's centre. */
export function aimAt(shooter: AircraftEntity, target: AircraftEntity) {
  const eye = shooter.state.position.clone().add(new Vector3(0, 0.8, 0));
  const d = target.state.position.clone().sub(eye).normalize();
  orientationFrom(Math.atan2(d.x, -d.z), Math.asin(d.y), 0, shooter.state.orientation);
}

export const count = (events: GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type).length;
