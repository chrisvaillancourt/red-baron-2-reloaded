/** Diagnostic: how does the (veteran AI) player die in career missions? (AI_SOAK=lossdiag) */
import { describe, it } from 'vitest';
import { createCampaignService, memoryStorage } from '../campaign';
import type { Nation } from '../core/types';
import { headlessModules } from '../game/autoplay';
import { SimCore, SIM_HZ } from '../game/simCore';
import { DEFAULT_SETTINGS } from '../core/settings';

const SOAK = (process.env.AI_SOAK ?? '').split(',');

describe.skipIf(!SOAK.includes('lossdiag'))('loss diag', () => {
  it('career losses', () => {
    const campaign = createCampaignService(memoryStorage());
    const careers: [Nation, string][] = [
      ['germany', '1917-04-05'], ['germany', '1918-04-01'], ['britain', '1917-04-05'], ['britain', '1918-04-01'],
      ['france', '1917-08-01'], ['usa', '1918-07-01'], ['germany', '1916-10-01'], ['britain', '1916-09-01'],
    ];
    const tally = new Map<string, number>();
    let n = 0;
    let seed = 1;
    for (const [nation, date] of careers) {
      const p = campaign.createPilot({ firstName: 'D', lastName: `P${seed}`, nation, startDate: date, difficulty: 'pilot' });
      p.rngSeed = seed++ * 7777;
      for (let i = 0; i < Number(process.env.AI_MISSIONS ?? 4); i++) {
        if (p.status !== 'active' && p.status !== 'hospital') break;
        if (p.status === 'hospital') campaign.returnToDuty?.(p);
        const m = campaign.generateMission(p, campaign.availableAircraft(p)[0]);
        const core = new SimCore(headlessModules, m, () => DEFAULT_SETTINGS.realism, { aiPlayer: true });
        const pl = core.world.player!;
        const log: string[] = [];
        const attackers = new Map<number, number>();
        core.bus.onAny((e) => {
          if (e.type === 'bullet-hit' && e.targetId === pl.id) attackers.set(e.shooterId, (attackers.get(e.shooterId) ?? 0) + 1);
          if (e.type === 'fire-started' && e.aircraftId === pl.id) log.push(`fire@${core.world.time.toFixed(0)}`);
          if (e.type === 'structural-failure' && e.aircraftId === pl.id) log.push(`struct(${e.part})@${core.world.time.toFixed(0)}`);
          if (e.type === 'pilot-hit' && e.aircraftId === pl.id) log.push(`${e.killed ? 'PILOT-KILLED' : 'wound'}@${core.world.time.toFixed(0)}`);
          if (e.type === 'engine-dead' && e.aircraftId === pl.id) log.push(`engine-dead@${core.world.time.toFixed(0)}`);
        });
        const h = 1 / SIM_HZ;
        while (!core.director.ended && core.world.time < 2400) core.step(h);
        const res = core.director.buildResult();
        n++;
        if (res.playerFate === 'killed' || res.playerFate === 'wounded' || res.playerFate === 'captured') {
          const shooters = [...attackers].map(([id, c]) => {
            const a = core.world.getEntity(id);
            return a && a.kind === 'aircraft' ? `${a.spec.shortName}/${a.skill}${a.aceId ? '/ACE ' + a.aceId : ''} x${c}` : `#${id} x${c}`;
          });
          const key = `${res.playerFate}:${pl.outcome}`;
          tally.set(key, (tally.get(key) ?? 0) + 1);
          process.stdout.write(
            `${nation} ${m.date} ${m.type.padEnd(14)} ${pl.spec.shortName.padEnd(9)} ${res.playerFate.padEnd(8)} out=${pl.outcome} t=${core.world.time.toFixed(0)} agl=${pl.state.heightAboveGround.toFixed(0)} v=${pl.state.airspeed.toFixed(0)} | ${log.join(' ')} | hit by ${shooters.join(', ')} | z=${JSON.stringify(Object.fromEntries(Object.entries(pl.damage.zones).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(2)])))}\n`,
          );
        }
        campaign.applyMissionResult(p, m, res);
      }
    }
    process.stdout.write(`\n${n} missions: ${[...tally].map(([k, v]) => `${k} ${v}`).join(' | ')}\n`);
  }, 3_600_000);
});
