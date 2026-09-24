/**
 * Long tuning/soak runs on the real sim. Skipped unless AI_SOAK is set:
 *   AI_SOAK=route,combat,struct AI_OUT=/path/log.txt pnpm vitest run src/ai/tuning.soak.test.ts
 * AI_SEEDS (default 6) and AI_TYPES (comma list) narrow the runs.
 */
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import type { AircraftId, SkillLevel, Waypoint } from '../core/types';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { runSim, SimWorld } from './testing/realSimHarness';
import { combatRun, historyTap, routeFlight } from './testing/realScenarios';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const only = process.env.AI_TYPES?.split(',') as AircraftId[] | undefined;
const SEEDS = Number(process.env.AI_SEEDS ?? 6);

function report(rows: string[]): void {
  const out = process.env.AI_OUT;
  const text = '\n' + rows.join('\n') + '\n';
  if (out) appendFileSync(out, text);
  else process.stdout.write(text);
}

type Matchup = [AircraftId, SkillLevel, AircraftId, SkillLevel, number | [number, number]];

const MATCHUPS: Matchup[] = [
  ['se5a', 'ace', 'albatros_dv', 'novice', 1],
  ['albatros_dv', 'ace', 'se5a', 'novice', 1],
  ['sopwith_camel', 'regular', 'fokker_dri', 'regular', 1],
  ['spad_xiii', 'veteran', 'fokker_dvii', 'veteran', 1],
  ['nieuport_17', 'regular', 'albatros_diii', 'regular', 1],
  ['airco_dh2', 'regular', 'fokker_eiii', 'regular', 1],
  ['se5a', 'regular', 'albatros_dv', 'regular', 2],
  ['sopwith_camel', 'regular', 'albatros_dv', 'regular', 4],
  ['spad_xiii', 'regular', 'fokker_dvii', 'regular', 4],
];

describe.skipIf(!SOAK.includes('route'))('soak: route + patrol for every type', () => {
  it('flies', () => {
    const rows: string[] = [];
    for (const spec of AIRCRAFT_LIST) {
      if (only && !only.includes(spec.id)) continue;
      const side = spec.nation === 'germany' ? 'central' : 'allied';
      const wps: Waypoint[] = [
        { x: 0, z: -5000, altitude: 1800, action: 'fly' },
        { x: 5000, z: -8000, altitude: 1500, action: 'fly' },
        { x: 8000, z: -3000, altitude: 1200, action: 'patrol', duration: 90 },
        { x: 2000, z: 2000, altitude: 1000, action: 'fly' },
      ];
      const world = new SimWorld({ flights: [routeFlight('a', side, spec.id, wps)], frontX: side === 'allied' ? 60000 : -60000 });
      const ac = world.addAircraft({ aircraftId: spec.id, side, x: 0, z: 0, alt: 1500, heading: 0, flightId: 'a' });
      const ctl = world.addAI(ac, 'regular');
      const minDist = wps.map(() => Infinity);
      let stallT = 0, minAgl = Infinity, maxG = 0, minV = Infinity;
      runSim(world, 700, {
        onStep: () => {
          const p = ac.state.position;
          wps.forEach((w, i) => (minDist[i] = Math.min(minDist[i], Math.hypot(w.x - p.x, w.z - p.z))));
          if (ac.state.stalled) stallT += 1 / 120;
          minAgl = Math.min(minAgl, ac.state.heightAboveGround);
          maxG = Math.max(maxG, ac.state.gLoad);
          minV = Math.min(minV, ac.state.airspeed);
          return !!ac.outcome;
        },
      });
      rows.push(
        `${spec.id.padEnd(18)} out=${String(ac.outcome ?? 'ok').padEnd(12)} t=${world.time.toFixed(0)} wp=${minDist.map((d) => d.toFixed(0)).join('/')} stall=${stallT.toFixed(1)}s minAgl=${minAgl.toFixed(0)} maxG=${maxG.toFixed(1)} minV=${minV.toFixed(0)} ${ctl.debugState}`,
      );
    }
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('combat'))('soak: combat matrix', () => {
  it('fights', () => {
    const rows: string[] = [];
    for (const [a, sa, b, sb, n] of MATCHUPS) {
      let aWins = 0, bWins = 0, draws = 0, tSum = 0, tEnd = 0, kills = 0, fA = 0, fB = 0, hA = 0, hB = 0, struct = 0, selfStruct = 0, crashes = 0, coll = 0; let shot = 0, solA = 0, solB = 0, firA = 0, firB = 0, defA = 0, defB = 0;
      const outcomes: Record<string, number> = {};
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = combatRun({ a, sa, b, sb, n, seed });
        if (r.aLeft > 0 && r.bLeft === 0) aWins++;
        else if (r.bLeft > 0 && r.aLeft === 0) bWins++;
        else draws++;
        tSum += r.firstKill ?? 600;
        tEnd += r.endTime;
        kills += r.kills;
        fA += r.firedA; fB += r.firedB; hA += r.hitsA; hB += r.hitsB;
        struct += r.struct; selfStruct += r.selfStruct; crashes += r.selfCrashes; coll += r.collisions;
        for (const [k, v] of Object.entries(r.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + v;
        shot += r.firstShot ?? 600; solA += r.statsA.solution; solB += r.statsB.solution; firA += r.statsA.firing; firB += r.statsB.firing; defA += r.statsA.defend; defB += r.statsB.defend;
      }
      const pct = (h: number, f: number) => ((100 * h) / Math.max(1, f)).toFixed(1);
      rows.push(
        `${JSON.stringify(n)} ${a}/${sa} vs ${b}/${sb}: A ${aWins} B ${bWins} draw ${draws} | 1stKill ${(tSum / SEEDS).toFixed(0)}s end ${(tEnd / SEEDS).toFixed(0)}s kills=${kills} | hitA ${pct(hA, fA)}% (${fA}) hitB ${pct(hB, fB)}% (${fB}) | 1stShot ${(shot / SEEDS).toFixed(0)}s sol/fire/def A ${(solA / SEEDS).toFixed(0)}/${(firA / SEEDS).toFixed(0)}/${(defA / SEEDS).toFixed(0)} B ${(solB / SEEDS).toFixed(0)}/${(firB / SEEDS).toFixed(0)}/${(defB / SEEDS).toFixed(0)} | struct=${struct} self=${selfStruct} selfCrash=${crashes} coll=${coll} ${JSON.stringify(outcomes)}`,
      );
    }
    report(rows);
  }, 1_800_000);
});

describe.skipIf(!SOAK.includes('terrain'))('soak: 30 min of low-level mixed dogfights over hills', () => {
  it('never flies into the ground', () => {
    const rows: string[] = [];
    const hills = (x: number, z: number) => 200 + 220 * Math.sin(x / 1300) * Math.cos(z / 1100) + 80 * Math.sin((x + z) / 500);
    const allied: AircraftId[] = ['se5a', 'sopwith_camel', 'spad_xiii', 'nieuport_17', 'sopwith_pup', 'bristol_f2b', 'airco_dh2', 'sopwith_triplane'];
    const central: AircraftId[] = ['albatros_dv', 'fokker_dri', 'fokker_dvii', 'pfalz_diiia', 'albatros_diii', 'fokker_eiii', 'halberstadt_clii', 'fokker_dviii'];
    const skills: SkillLevel[] = ['novice', 'regular', 'veteran', 'ace'];
    let simTime = 0, selfCrashes = 0, kills = 0;
    for (let run = 0; run < 10; run++) {
      const world = new SimWorld({ ground: hills, frontX: 1e9, seed: run + 1 });
      const all = [];
      for (let i = 0; i < 4; i++) {
        all.push(world.addAircraft({ aircraftId: central[(run + i) % 8], side: 'central', x: i * 200, z: -900, alt: 700 + 60 * i, heading: Math.PI, flightId: 'c', skill: skills[(run + i) % 4] }));
        all.push(world.addAircraft({ aircraftId: allied[(run + 2 * i) % 8], side: 'allied', x: i * 200, z: 900, alt: 650 + 60 * i, heading: 0, flightId: 'a', skill: skills[(run + 3 - i) % 4] }));
      }
      all.forEach((a, i) => world.addAI(a, a.skill, { seed: run * 50 + i }));
      const tap = historyTap(rows, `run ${run}`);
      runSim(world, 180, { onStep: () => tap(world) });
      simTime += world.time;
      const bad = all.filter((a) => (a.outcome === 'crashed' || a.outcome === 'ditched') && a.damage.lastAttackerId === null);
      selfCrashes += bad.length;
      kills += world.eventsOf('aircraft-destroyed').length;
      rows.push(`run ${run}: self-crashes ${bad.map((a) => `${a.spec.id}/${a.skill}`).join(',') || 'none'}; destroyed ${world.eventsOf('aircraft-destroyed').length}`);
    }
    rows.push(`TOTAL sim ${(simTime / 60).toFixed(0)} min, self-crashes ${selfCrashes}, destroyed ${kills}`);
    report(rows.filter((r) => !r.startsWith('  t=') || process.env.AI_VERBOSE));
  }, 1_800_000);
});

describe.skipIf(!SOAK.includes('struct'))('soak: diagnose self-inflicted losses', () => {
  it('logs history before structural failures / uncredited crashes', () => {
    const rows: string[] = [];
    for (const [a, sa, b, sb, n] of MATCHUPS) {
      for (let seed = 1; seed <= Math.min(SEEDS, 3); seed++) {
        combatRun({ a, sa, b, sb, n, seed, tap: historyTap(rows, `${a} v ${b} s${seed}`) });
      }
    }
    report(rows);
  }, 1_800_000);
});
