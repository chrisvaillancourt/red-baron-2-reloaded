/**
 * Per-type traits the AI derives from AircraftSpec: fighting style, stall and
 * structural limits, gun ballistics. Stall/structural figures come from the
 * sim's calibrated coefficients (src/sim getCoefficients), so the AI flies the
 * same envelope the flight model enforces.
 */
import type { AircraftId, AircraftSpec } from '../core/types';
import { GUNS } from '../data/aircraft';
import { getCoefficients } from '../sim/coefficients';

export type CombatStyle = 'turn' | 'energy' | 'mixed';

const ENERGY: AircraftId[] = ['spad_vii', 'spad_xiii', 'se5a', 'pfalz_diiia', 'fokker_dvii', 'bristol_f2b', 'dh4'];
const TURN: AircraftId[] = [
  'fokker_dri', 'sopwith_camel', 'sopwith_triplane', 'nieuport_11', 'nieuport_17', 'nieuport_28',
  'sopwith_pup', 'fokker_dviii', 'airco_dh2', 'fokker_eiii',
];

export interface AircraftTraits {
  style: CombatStyle;
  /** 1 g stall speed at sea level, m/s. */
  stallSpeed: number;
  /** Stall angle of attack (fuselage datum, as FlightState.aoa), rad. */
  stallAoa: number;
  /** Typical cruise speed, m/s. */
  cruiseSpeed: number;
  maxSpeed: number;
  /** Best-climb true airspeed at sea level, m/s. */
  bestClimbSpeed: number;
  /** Muzzle velocity of the fixed forward guns, m/s (0 if none). */
  fixedMuzzleVelocity: number;
  hasFixedGuns: boolean;
  hasFlexibleGun: boolean;
  isTwoSeater: boolean;
  /** Never-exceed speed, m/s: the airframe fails beyond it. */
  vne: number;
  /** Positive structural load limit, g. */
  gLimit: number;
  /** Structural caution: dives are governed to stay below this speed. */
  maxSafeDiveSpeed: number;
}

export function traitsFor(spec: AircraftSpec): AircraftTraits {
  const p = spec.performance;
  const co = getCoefficients(spec);
  const fixed = spec.guns.filter((g) => g.mount !== 'flexible');
  const maxSpeed = co.vMax;
  return {
    style: ENERGY.includes(spec.id) ? 'energy' : TURN.includes(spec.id) ? 'turn' : 'mixed',
    stallSpeed: co.vStallSL,
    stallAoa: co.alphaStall,
    cruiseSpeed: maxSpeed * 0.8,
    maxSpeed,
    bestClimbSpeed: co.vBestClimbSL,
    fixedMuzzleVelocity: fixed.length ? GUNS[fixed[0].type].muzzleVelocity : 0,
    hasFixedGuns: fixed.length > 0,
    hasFlexibleGun: spec.guns.some((g) => g.mount === 'flexible'),
    isTwoSeater: spec.geometry.crew === 2,
    vne: co.vne,
    gLimit: co.gLimit,
    maxSafeDiveSpeed: co.vne * (0.86 + 0.02 * p.structuralStrength),
  };
}
