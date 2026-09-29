/** Test fixture: a headless quick flight (autoplayer in the player's seat) with a flight recorder. */
import { buildQuickMission } from '../../campaign';
import type { QuickMissionOptions } from '../../core/campaignTypes';
import { DEFAULT_SETTINGS } from '../../core/settings';
import type { MissionDefinition, MissionResult } from '../../core/types';
import { QUICK_DEFAULTS } from '../../data/quickDefaults';
import { headlessModules } from '../autoplay';
import { FlightRecorder } from '../flightRecorder';
import { SIM_HZ, SimCore } from '../simCore';

export interface RecordedFlight {
  options: QuickMissionOptions;
  mission: MissionDefinition;
  result: MissionResult;
  /** bullet-hit events on the player, counted independently of the recorder. */
  hitsOnPlayer: number;
  /** Seconds with the player alive and an enemy within 1.5 km, sampled every 12 steps (0.1 s), independently. */
  combatOnPlayerS: number;
}

export function recordedQuickFlight(seed = 5000, maxTime = 600, options: QuickMissionOptions = { ...QUICK_DEFAULTS }): RecordedFlight {
  const mission = buildQuickMission(options, seed);
  const core = new SimCore(headlessModules, mission, () => DEFAULT_SETTINGS.realism, { aiPlayer: true });
  const rec = new FlightRecorder(core);
  const player = core.world.player!;
  let hitsOnPlayer = 0;
  core.bus.onAny((e) => {
    if (e.type === 'bullet-hit' && e.targetId === player.id) hitsOnPlayer++;
  });
  const h = 1 / SIM_HZ;
  let combatOnPlayerS = 0;
  let n = 0;
  while (!core.director.ended && core.world.time < maxTime) {
    core.step(h);
    rec.afterStep();
    if (++n % 12 === 0 && player.outcome === null) {
      const near = core.world.aircraft.some((a) => a.side !== player.side && a.outcome === null && a.state.position.distanceTo(player.state.position) < 1500);
      if (near) combatOnPlayerS += 12 * h;
    }
  }
  if (!core.director.ended && !core.director.requestEndFlight()) core.director.abort();
  const result = core.director.buildResult();
  result.telemetry = rec.telemetry();
  rec.dispose();
  core.dispose();
  return { options, mission, result, hitsOnPlayer, combatOnPlayerS };
}
