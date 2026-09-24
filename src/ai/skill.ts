/**
 * Skill profiles. Skill is a continuous value t in [0, 1] (novice -> ace)
 * so RealismSettings.enemySkillBias can shift it smoothly.
 */
import type { FlightRole, RealismSettings, SkillLevel } from '../core/types';
import { clamp, lerp } from './math';

export interface SkillProfile {
  t: number;
  /** Distance at which enemies are noticed, m. */
  spotRange: number;
  /** Half-angle of the blind cone behind (below/behind the tail), rad. */
  rearBlindCone: number;
  /** Enemies inside the blind cone are still noticed inside this range, m. */
  blindSpotRange: number;
  perceptionInterval: number; // s between perception sweeps
  reactionDelay: number; // s before reacting to a new threat
  memory: number; // s a spotted enemy is remembered when out of sight
  maxG: number;
  aimNoiseRad: number; // 1-sigma random aim wander
  leadError: number; // fractional under-lead of the gunnery solution
  fireConeRad: number; // extra cone beyond the target's angular size
  fireRange: number; // m, opens fire inside this range
  burstLength: number; // s
  burstPause: number; // s
  defensiveThreshold: number; // threat level that triggers defence
  /** Probability per perception tick of ignoring threats while attacking (target fixation). */
  fixation: number;
  jamClearRate: number; // clear-jam presses per second
  groundMargin: number; // minimum comfortable height above ground, m
  /** 0..1 inclination to gain altitude / use energy before engaging. */
  energyTactics: number;
}

const SKILL_T: Record<SkillLevel, number> = { novice: 0, regular: 0.35, veteran: 0.7, ace: 1 };

export function skillValue(skill: SkillLevel, role: FlightRole, realism: RealismSettings): number {
  const bias = role === 'enemy' ? realism.enemySkillBias * 0.3 : 0;
  return clamp(SKILL_T[skill] + bias, 0, 1);
}

export function makeSkillProfile(t: number): SkillProfile {
  const deg = Math.PI / 180;
  return {
    t,
    spotRange: lerp(2600, 5000, t),
    rearBlindCone: lerp(55, 20, t) * deg,
    blindSpotRange: lerp(200, 600, t),
    perceptionInterval: lerp(0.9, 0.2, t),
    reactionDelay: lerp(1.6, 0.25, t),
    memory: lerp(3, 12, t),
    maxG: lerp(3.2, 5.0, t),
    aimNoiseRad: lerp(1.3, 0.15, t) * deg,
    leadError: lerp(0.35, 0.04, t),
    fireConeRad: lerp(2.6, 0.7, t) * deg,
    fireRange: lerp(400, 200, t),
    burstLength: lerp(2.0, 0.6, t),
    burstPause: lerp(0.25, 0.6, t),
    defensiveThreshold: lerp(0.55, 0.42, t),
    fixation: lerp(0.5, 0, t),
    jamClearRate: lerp(3, 8, t),
    groundMargin: lerp(160, 90, t),
    energyTactics: lerp(0, 1, t),
  };
}
