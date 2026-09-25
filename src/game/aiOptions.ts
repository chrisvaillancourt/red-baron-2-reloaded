/**
 * The one mapping from the game's per-slot AI options to src/ai's controller options.
 * Both the real game (flightModules.ts, lazy chunk) and the headless autoplayer
 * (autoplay.ts) use it, so the soaks measure the same AI players meet.
 */
import type { AIControllerOptions as AIOptions } from '../ai/controller';
import type { AircraftEntity } from '../core/types';
import type { AIControllerOptions } from './moduleTypes';

export function aiControllerOptions(ac: AircraftEntity, o: AIControllerOptions, setGunnerTarget: AIOptions['setGunnerTarget']): AIOptions {
  return {
    role: o.flight.role,
    task: o.flight.task,
    skill: o.skill,
    leaderId: o.leaderId === ac.id ? undefined : o.leaderId,
    formationSlot: o.slot > 0 ? o.slot : undefined,
    realism: o.realism,
    setGunnerTarget,
    homeAerodromeId: o.homeAerodromeId,
    aceId: ac.aceId,
  };
}
