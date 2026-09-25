/**
 * Gunnery diagnostic (AI_SOAK=gundiag): flies seeded quick dogfights and reports, per
 * side, how much of the fight each pilot spent with a firing solution, how much it fired,
 * and how many of its rounds hit. Separates "can't get the nose on" (geometry) from
 * "nose on but missing" (lead/aim) from "not pulling the trigger" (fire gates).
 *
 *   AI_SOAK=gundiag AI_GD_REPS=8 AI_GD_SET=default pnpm vitest run src/ai/gundiag.soak.test.ts
 */
import { describe, it } from 'vitest';
import { Vector3 } from 'three';
import { buildQuickMission } from '../campaign';
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftEntity, AircraftId } from '../core/types';
import { headlessModules } from '../game/autoplay';
import { SimCore, SIM_HZ } from '../game/simCore';
import { DEFAULT_SETTINGS } from '../core/settings';
import { forwardOf } from './math';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const REPS = Number(process.env.AI_GD_REPS ?? 8);
const SET = process.env.AI_GD_SET ?? 'default';

const base = (player: AircraftId, enemy: AircraftId): QuickMissionOptions => ({
  type: 'dogfight', playerAircraft: player, enemyAircraft: enemy, enemyCount: 2, wingmen: 1,
  enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35,
});
const SETS: Record<string, QuickMissionOptions[]> = {
  default: [base('sopwith_camel', 'albatros_dv')],
  reverse: [base('albatros_dv', 'sopwith_camel')],
  mirror: [base('sopwith_camel', 'sopwith_camel'), base('albatros_dv', 'albatros_dv')],
};

interface Acc {
  engage: number; near: number; nose30: number; nose10: number; solution: number; firing: number;
  shots: number; hits: number; speed: number; speedN: number; energyLoss: number; stall: number; recover: number; defend: number;
}
const zero = (): Acc => ({ engage: 0, near: 0, nose30: 0, nose10: 0, solution: 0, firing: 0, shots: 0, hits: 0, speed: 0, speedN: 0, energyLoss: 0, stall: 0, recover: 0, defend: 0 });

describe.skipIf(!SOAK.includes('gundiag'))('gunnery diag', () => {
  it('reports per-type solution / firing / hit rates', () => {
    const lines: string[] = [];
    for (const q of SET.split(',').flatMap((s) => SETS[s] ?? [])) {
      const acc = new Map<string, Acc>();
      const key = (a: AircraftEntity, pl: AircraftEntity) => `${a.side === pl.side ? 'P' : 'E'}:${a.spec.shortName}${a === pl ? '(pl)' : ''}`;
      for (let r = 0; r < REPS; r++) {
        const m = buildQuickMission(q, 5000 + r * 131);
        const core = new SimCore(headlessModules, m, () => DEFAULT_SETTINGS.realism, { aiPlayer: true });
        const pl = core.world.player!;
        const byId = new Map(core.world.aircraft.map((a) => [a.id, a]));
        core.bus.onAny((e) => {
          if (e.type === 'gun-fired') { const a = byId.get(e.shooterId); if (a) get(key(a, pl)).shots++; }
          if (e.type === 'bullet-hit') { const a = byId.get(e.shooterId); const t = byId.get(e.targetId); if (a && t && t.side !== a.side) get(key(a, pl)).hits++; }
        });
        function get(k: string): Acc { let v = acc.get(k); if (!v) acc.set(k, (v = zero())); return v; }
        const h = 1 / SIM_HZ;
        const f = new Vector3();
        const prevE = new Map<number, number>();
        let tick = 0;
        while (!core.director.ended && core.world.time < 900) {
          core.step(h);
          if (++tick % 12) continue; // sample at 10 Hz
          const dt = 12 * h;
          for (const a of core.world.aircraft) {
            if (a.outcome || !a.state) continue;
            const ctl = core.ai.get(a.id) as unknown as { targetId?: number | null; phase?: string; autopilot?: { recovering?: boolean } } | undefined;
            const g = get(key(a, pl));
            const tId = ctl?.targetId;
            const t = tId != null ? byId.get(tId) : undefined;
            if (ctl?.phase === 'defend') g.defend += dt;
            if (!t || t.outcome || t.side === a.side) continue;
            g.engage += dt;
            if (a.state.stalled) g.stall += dt;
            if (ctl?.autopilot?.recovering) g.recover += dt;
            g.speed += a.state.airspeed; g.speedN++;
            const e = a.state.position.y * 9.81 + 0.5 * a.state.airspeed ** 2;
            const pe = prevE.get(a.id);
            if (pe != null && pe > e) g.energyLoss += (pe - e) / 9.81;
            prevE.set(a.id, e);
            const rel = t.state.position.clone().sub(a.state.position);
            const d = rel.length();
            if (d > 500) continue;
            g.near += dt;
            forwardOf(a.state.orientation, f);
            const ang = Math.acos(Math.min(1, f.dot(rel.normalize()))) * 57.3;
            if (ang < 30) g.nose30 += dt;
            if (ang < 10) g.nose10 += dt;
          }
        }
        for (const a of core.world.aircraft) {
          const st = (core.ai.get(a.id) as unknown as { stats?: { gunsSolutionTime: number; firingTime: number } } | undefined)?.stats;
          if (st) { const g = get(key(a, pl)); g.solution += st.gunsSolutionTime; g.firing += st.firingTime; }
        }
      }
      lines.push(`=== ${q.playerAircraft} v ${q.enemyAircraft} reps=${REPS}`);
      lines.push('who | engage s | <500m s | nose<30 s | nose<10 s | solution s | firing s | shots | hits | hit% | mean v | alt-equiv lost m | stall s | recover s | defend s');
      for (const [k, g] of [...acc].sort()) {
        lines.push([k.padEnd(14), g.engage.toFixed(0), g.near.toFixed(0), g.nose30.toFixed(0), g.nose10.toFixed(0), g.solution.toFixed(1), g.firing.toFixed(0), g.shots, g.hits, g.shots ? ((100 * g.hits) / g.shots).toFixed(1) : '-', g.speedN ? (g.speed / g.speedN).toFixed(0) : '-', g.energyLoss.toFixed(0), g.stall.toFixed(0), g.recover.toFixed(0), g.defend.toFixed(0)].join(' | '));
      }
    }
    process.stdout.write(lines.join('\n') + '\n');
  }, 3_600_000);
});
