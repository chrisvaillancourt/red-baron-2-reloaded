/**
 * AI pilots. See docs/ai.md.
 *
 *   const ai = createAIController(ac, { role, task, skill, leaderId, formationSlot, realism, setGunnerTarget });
 *   // each AI tick (30 Hz recommended), before stepFlight:
 *   ai.update(ac, world, dt);
 */
export { createAIController, getAIPilot, fixedAmmo, AIPilot } from './controller';
export type { AIControllerOptions, AIPhase, AIStats } from './controller';
export { Autopilot } from './autopilot';
export type { SteerCommand, AutopilotGains } from './autopilot';
export { leadSolution } from './gunnery';
export { traitsFor } from './traits';
export type { AircraftTraits, CombatStyle } from './traits';
export { makeSkillProfile, skillValue } from './skill';
export type { SkillProfile } from './skill';
