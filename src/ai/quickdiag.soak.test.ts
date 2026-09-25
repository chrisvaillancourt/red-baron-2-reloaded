/** Diagnostic: trace a quick ground-attack mission (AI_SOAK=quickdiag). */
import { describe, it } from 'vitest';
import { buildQuickMission } from '../campaign';
import type { QuickMissionOptions } from '../core/campaignTypes';
import { headlessModules } from '../game/autoplay';
import { SimCore, SIM_HZ } from '../game/simCore';
import { DEFAULT_SETTINGS } from '../core/settings';
import { fixedAmmoFraction } from './controller';

const SOAK = (process.env.AI_SOAK ?? '').split(',');

describe.skipIf(!SOAK.includes('quickdiag'))('quick diag', () => {
  it('trace', () => {
    const which = process.env.AI_Q ?? 'dvii';
    const q: QuickMissionOptions =
      which === 'default'
        ? { type: 'ground-attack', playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 2, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35 }
        : which === 'dvii'
        ? { type: 'ground-attack', playerAircraft: 'fokker_dvii', enemyAircraft: 'spad_xiii', enemyCount: 2, wingmen: 1, enemySkill: 'veteran', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.5 }
        : { type: 'ground-attack', playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dri', enemyCount: 3, wingmen: 2, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2000, startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3 };
    const m = buildQuickMission(q, Number(process.env.AI_QSEED ?? 1009));
    process.stdout.write(`flights: ${m.flights.map((f) => `${f.id}/${f.role}/${f.task}/${f.aircraftId}x${f.members.length} delay=${f.spawnDelay ?? 0} start=(${f.start.x},${f.start.altitude},${f.start.z}) wps=${f.waypoints.map((w) => w.action).join(',')}`).join(' | ')}\n`);
    const core = new SimCore(headlessModules, m, () => DEFAULT_SETTINGS.realism, { aiPlayer: true });
    const pl = core.world.player!;
    core.bus.onAny((e) => {
      if (e.type === 'aircraft-destroyed' || e.type === 'ground-destroyed' || e.type === 'objective-complete' || (e.type === 'pilot-hit' && e.aircraftId === pl.id)) process.stdout.write(`  EV t=${core.world.time.toFixed(0)} ${JSON.stringify({ ...e, position: undefined })}\n`);
    });
    const h = 1 / SIM_HZ;
    let next = 0;
    while (!core.director.ended && core.world.time < 1200) {
      core.step(h);
      if (core.world.time >= next) {
        next += 5;
        const rows = core.world.aircraft
          .filter((a) => !a.outcome)
          .map((a) => {
            const ctl = core.ai.get(a.id) as { debugState?: string } | undefined;
            const agl = a.state.heightAboveGround.toFixed(0);
            return `${a.id === pl.id ? 'P' : a.side[0]}${a.id}:${a.spec.shortName} ${ctl?.debugState ?? '-'} agl=${agl} v=${a.state.airspeed.toFixed(0)} ammo=${(fixedAmmoFraction(a) * 100).toFixed(0)}% dmg=${Object.values(a.damage.zones).reduce((s, v) => s + v, 0).toFixed(2)} d=${(a.state.position.distanceTo(pl.state.position) / 1000).toFixed(1)}`;
          });
        process.stdout.write(`t=${core.world.time.toFixed(0)} ${rows.join(' | ')}\n`);
      }
    }
    process.stdout.write(`END fate ${core.director.buildResult().playerFate} outcome ${pl.outcome} t=${core.world.time.toFixed(0)}\n`);
  }, 600_000);
});
