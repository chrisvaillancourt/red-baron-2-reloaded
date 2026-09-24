/**
 * Per-type traits the AI derives from AircraftSpec: fighting style, stall
 * estimates, gun ballistics. Kept independent of the flight model so the AI
 * adapts to any sim that honours the ControlInputs contract.
 */
import type { AircraftId, AircraftSpec } from '../core/types';
import { GUNS } from '../data/aircraft';
import { DEG, G } from './math';

export type CombatStyle = 'turn' | 'energy' | 'mixed';

const ENERGY: AircraftId[] = ['spad_vii', 'spad_xiii', 'se5a', 'pfalz_diiia', 'fokker_dvii', 'bristol_f2b', 'dh4'];
const TURN: AircraftId[] = [
  'fokker_dri', 'sopwith_camel', 'sopwith_triplane', 'nieuport_11', 'nieuport_17', 'nieuport_28',
  'sopwith_pup', 'fokker_dviii', 'airco_dh2', 'fokker_eiii',
];

export interface AircraftTraits {
  style: CombatStyle;
  /** 1 g stall speed at sea level, m/s (estimate). */
  stallSpeed: number;
  /** Stall angle of attack, rad (estimate). */
  stallAoa: number;
  /** Typical cruise speed, m/s. */
  cruiseSpeed: number;
  maxSpeed: number;
  /** Muzzle velocity of the fixed forward guns, m/s (0 if none). */
  fixedMuzzleVelocity: number;
  hasFixedGuns: boolean;
  hasFlexibleGun: boolean;
  isTwoSeater: boolean;
  /** Structural caution: fragile types avoid sustained high-speed dives. */
  maxSafeDiveSpeed: number;
}

export function traitsFor(spec: AircraftSpec): AircraftTraits {
  const p = spec.performance;
  const layout = spec.geometry.layout;
  const clMax = layout === 'triplane' ? 1.45 : spec.id === 'fokker_dvii' ? 1.4 : layout === 'monoplane' ? 1.1 : 1.25;
  const stallSpeed = Math.sqrt((2 * p.massLoaded * G) / (1.225 * p.wingArea * clMax));
  const stallAoa = (layout === 'triplane' || spec.id === 'fokker_dvii' ? 18 : 15) * DEG;
  const fixed = spec.guns.filter((g) => g.mount !== 'flexible');
  const maxSpeed = p.maxSpeedKmh / 3.6;
  return {
    style: ENERGY.includes(spec.id) ? 'energy' : TURN.includes(spec.id) ? 'turn' : 'mixed',
    stallSpeed,
    stallAoa,
    cruiseSpeed: maxSpeed * 0.8,
    maxSpeed,
    fixedMuzzleVelocity: fixed.length ? GUNS[fixed[0].type].muzzleVelocity : 0,
    hasFixedGuns: fixed.length > 0,
    hasFlexibleGun: spec.guns.some((g) => g.mount === 'flexible'),
    isTwoSeater: spec.geometry.crew === 2,
    maxSafeDiveSpeed: maxSpeed * (1.15 + 0.35 * p.structuralStrength),
  };
}
