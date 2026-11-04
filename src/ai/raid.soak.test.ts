/**
 * Quick bombing-raid survey (AI_SOAK=raid): flies seeded quick "Bombing raid" missions with the
 * autoplayer leading the formation, and reports per setup the bombs on target, the targets
 * destroyed, the bombers, escorts and interceptors lost, and the player's fate.
 *
 *   AI_SOAK=raid AI_RAID_REPS=24 AI_RAID_SET=default pnpm vitest run src/ai/raid.soak.test.ts
 *
 * AI_RAID_SET: `default` (D.H.4s against regular D.Vs, with and without an escort, and
 * against the Quick Mission screen's veteran D.VIIs), `escort` (escort sizes). AI_TACTICS
 * flips src/ai/tactics.ts TACTICS_FLAGS (bomberFormation, blindSpot, ...) for A/B runs.
 *
 * Bombs are loaded here for every flight tasked `bomb`, standing in for the game layer
 * (track C loads them in src/game); loading twice is harmless.
 */
import { describe, it } from 'vitest';
import { applyTacticsFlagsFromEnv } from './tactics';
import { buildQuickMission } from '../campaign';
import type { AircraftEntity, MissionDefinition } from '../core/types';
import { getBombStats, loadBombs } from '../sim';
import { headlessModules, runAutoplay, type AutoplayReport } from '../game/autoplay';
import type { SimCoreModules } from '../game/simCore';
import { positiveIntEnv, selectSets } from '../game/testing/env';
import { RAID_SETS } from './testing/surveySets';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
applyTacticsFlagsFromEnv(process.env);
const REPS = positiveIntEnv('AI_RAID_REPS', process.env.AI_RAID_REPS, 12);
const SET = process.env.AI_RAID_SET ?? 'default';


interface RaidRun {
  rep: AutoplayReport;
  carried: number;
  dropped: number;
  onTarget: number;
  targetsDestroyed: number;
  targets: number;
  bombers: number;
  bombersLost: number;
  escorts: number;
  escortsLost: number;
  interceptors: number;
  interceptorsLost: number;
}

const lost = (a: AircraftEntity) => a.outcome !== null && a.outcome !== 'landed-friendly' && a.outcome !== 'disengaged';

function flyRaid(m: MissionDefinition): RaidRun {
  const seen: AircraftEntity[] = [];
  const modules: SimCoreModules = {
    ...headlessModules,
    createAIController: (ac, o) => {
      seen.push(ac);
      if (o.flight.task === 'bomb') loadBombs(ac);
      return headlessModules.createAIController(ac, o);
    },
  };
  const carried = new Map<AircraftEntity, number>();
  const rep = runAutoplay(m, { maxTime: 1500, modules });
  for (const ac of seen) carried.set(ac, ac.spec.bombs?.reduce((n, s) => n + s.count, 0) ?? 0);
  const task = (ac: AircraftEntity) => m.flights.find((f) => f.id === ac.flightId)?.task;
  const bombers = seen.filter((a) => task(a) === 'bomb');
  const escorts = seen.filter((a) => task(a) === 'escort');
  const interceptors = seen.filter((a) => a.side !== bombers[0]?.side);
  const bombWp = m.flights[0].waypoints.find((w) => w.action === 'bomb');
  const targets = bombWp?.targetIds?.length ?? 0;
  return {
    rep,
    carried: bombers.reduce((n, a) => n + (carried.get(a) ?? 0), 0),
    dropped: bombers.reduce((n, a) => n + getBombStats(a).dropped, 0),
    onTarget: bombers.reduce((n, a) => n + getBombStats(a).hits, 0),
    targetsDestroyed: rep.groundDestroyed,
    targets,
    bombers: bombers.length,
    bombersLost: bombers.filter(lost).length,
    escorts: escorts.length,
    escortsLost: escorts.filter(lost).length,
    interceptors: interceptors.length,
    interceptorsLost: interceptors.filter(lost).length,
  };
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

export const RAID_HEADER = 'raid setup | n | dropped/carried | on target/dropped | targets destroyed | success | bombers lost | escorts lost | interceptors lost | player down';

describe.skipIf(!SOAK.includes('raid'))('quick bombing raid survey', () => {
  it('reports bombs on target and losses per setup', () => {
    const setups = selectSets('AI_RAID_SET', SET, RAID_SETS);
    const lines = [`raid set=${SET} reps=${REPS} tactics=${process.env.AI_TACTICS ?? 'default'}`, RAID_HEADER];
    for (const s of setups) {
      const runs: RaidRun[] = [];
      for (let r = 0; r < REPS; r++) runs.push(flyRaid(buildQuickMission(s, 7000 + r * 131)));
      const sum = (f: (x: RaidRun) => number) => runs.reduce((n, x) => n + f(x), 0);
      const down = runs.filter((x) => x.rep.result.playerFate === 'killed' || x.rep.result.playerFate === 'captured').length;
      lines.push(
        [
          s.label,
          runs.length,
          `${sum((x) => x.dropped)}/${sum((x) => x.carried)} (${pct(sum((x) => x.dropped), sum((x) => x.carried))})`,
          `${sum((x) => x.onTarget)}/${sum((x) => x.dropped)} (${pct(sum((x) => x.onTarget), sum((x) => x.dropped))})`,
          `${sum((x) => x.targetsDestroyed)}/${sum((x) => x.targets)}`,
          pct(runs.filter((x) => x.rep.result.missionSuccess).length, runs.length),
          `${sum((x) => x.bombersLost)}/${sum((x) => x.bombers)} (${pct(sum((x) => x.bombersLost), sum((x) => x.bombers))})`,
          `${sum((x) => x.escortsLost)}/${sum((x) => x.escorts)}`,
          `${sum((x) => x.interceptorsLost)}/${sum((x) => x.interceptors)}`,
          `${down} (${pct(down, runs.length)})`,
        ].join(' | '),
      );
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
