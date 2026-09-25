/**
 * Simulation module: flight model, combat, atmosphere and helpers.
 * See docs/sim.md.
 */
import type { SimModule } from '../core/interfaces';
import { createFlightState, stepFlight } from './flightModel';

export const sim: SimModule = { createFlightState, stepFlight };

export { airDensityAt, createFlightEnvironment, densityRatio, temperatureAt, G, type SimFlightEnvironment } from './atmosphere';
export {
  SIM_DT,
  bankAngle,
  createFlightState,
  getSimInternal,
  headingOf,
  isStoppedOnGround,
  pilotGTolerance,
  tailPressureRatio,
  orientationFrom,
  pitchAngle,
  stepFlight,
  stickForAlpha,
  type FailedPart,
  type SimInternal,
} from './flightModel';
export { bestClimb, getCoefficients, maxLevelSpeed, type FlightCoefficients } from './coefficients';
export {
  aimFlexibleGun,
  createCombatSystem,
  getGunnerTarget,
  setGunnerTarget,
  type CombatOptions,
  type SimCombatSystem,
} from './combat';
export { getHitModel, BALLOON_RADIUS, GROUND_TARGET_BOXES } from './hitboxes';
export { createAircraftEntity, createControls, createDamageState, createGunStates, type NewAircraftOptions } from './entity';
export { Autopilot, type AutopilotTarget } from './autopilot';
export { createRng, type Rng } from './rng';
