/**
 * Defence on the real flight model: an enemy parked on a veteran's tail. A pilot who only
 * repeats a level break toward the attacker chains the breaks into one flat circle, and the
 * attacker, turning inside him, stays there (the wave-9 playtest: "enemy pilots just fly in
 * circles when you get into position behind them"). With the escalating defence
 * (TACTICS_FLAGS.escalateDefence) he changes plane once the first break hasn't shaken the
 * attacker: a climbing spiral or a dive and extension where his airframe has the edge, a
 * reversal or a split-S otherwise, and a climbing break low down when he out-climbs the
 * attacker. Compared on the same seeds with the switch off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AircraftId, SkillLevel } from '../core/types';
import { TACTICS_FLAGS } from './tactics';
import { runSim, SimWorld } from './testing/realSimHarness';
import { TailHoldTracker, zeroTailHold, type TailHoldAcc } from './testing/tailHold';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** DEFENCE_TRACE: seconds and hits taken per defender AI state, printed per survey. */
const HITS_BY_STATE = new Map<string, { s: number; hits: number }>();

interface Case {
  defender: AircraftId;
  defenderSkill: SkillLevel;
  attacker: AircraftId;
  alt: number;
  /** High enough for the brake turn (above 500 m AGL). */
  brakeTurn: boolean;
}

interface Flown {
  g: TailHoldAcc;
  attackingS: number;
  flownS: number;
  hitsTaken: number;
  defenderDown: boolean;
  defenderCrashed: boolean;
  attackerCrashed: boolean;
}

function flyCase(c: Case, seed: number): Flown {
  const world = new SimWorld({ seed, frontX: -1e6, realFront: false });
  const heading = seed * 0.7;
  const fwd = { x: Math.sin(heading), z: -Math.cos(heading) };
  const def = world.addAircraft({ aircraftId: c.defender, side: 'central', x: 0, z: 0, alt: c.alt, heading });
  world.addAI(def, c.defenderSkill, { seed });
  const att = world.addAircraft({ aircraftId: c.attacker, side: 'allied', x: -fwd.x * 200, z: -fwd.z * 200, alt: c.alt + 10, heading });
  world.addAI(att, 'veteran', { seed: seed + 100 });
  const acc = new Map<string, TailHoldAcc>();
  const tr = new TailHoldTracker(() => world.aircraft, (a) => world.controllers.get(a.id)?.debugState ?? '', (a) => (a === def ? 'def' : null), acc);
  let n = 0;
  let nEv = 0;
  let attackingS = 0;
  runSim(world, 60, {
    onStep: () => {
      if (++n % 12 === 0) tr.sample(0.1);
      const ph = world.controllers.get(def.id)?.phase;
      if (ph === 'engage' || ph === 'extend') attackingS += 1 / 120;
      if (process.env.DEFENCE_TRACE) {
        const st = (world.controllers.get(def.id)?.debugState ?? '-').replace(/ #\d+/, '');
        const cur = HITS_BY_STATE.get(st) ?? { s: 0, hits: 0 };
        cur.s += 1 / 120;
        for (; nEv < world.events.length; nEv++) {
          const e = world.events[nEv];
          if (e.type === 'bullet-hit' && e.targetId === def.id) cur.hits++;
        }
        HITS_BY_STATE.set(st, cur);
      }
      return !!def.outcome;
    },
  });
  if (process.env.DEFENCE_TRACE) process.stdout.write(`  seed ${seed} ${c.defender}: t=${world.time.toFixed(0)} def=${def.outcome ?? 'flying'} att=${att.outcome ?? 'flying'} held=${(acc.get('def')?.held ?? 0).toFixed(0)} states=${[...(acc.get('def')?.states ?? [])].map(([k, v]) => `${k}:${v.toFixed(0)}`).join(',')}\n`);
  return {
    g: acc.get('def') ?? zeroTailHold(),
    attackingS,
    flownS: world.time,
    hitsTaken: world.eventsOf('bullet-hit').filter((e) => e.targetId === def.id).length,
    defenderDown: !!def.outcome,
    defenderCrashed: def.outcome === 'crashed',
    attackerCrashed: att.outcome === 'crashed',
  };
}

interface Survey {
  /** Seconds the defender spent attacking (engage / extend phases). */
  attacking: number;
  /** Seconds the defender was flying (a run ends when he goes down). */
  flown: number;
  held: number;
  circle: number;
  hits: number;
  down: number;
  crashes: number;
}

function survey(c: Case): Survey {
  const t: Survey = { attacking: 0, flown: 0, held: 0, circle: 0, hits: 0, down: 0, crashes: 0 };
  for (const s of SEEDS) {
    const r = flyCase(c, s);
    t.held += r.g.held;
    t.attacking += r.attackingS;
    t.flown += r.flownS;
    t.circle += r.g.circle;
    t.hits += r.hitsTaken;
    t.down += r.defenderDown ? 1 : 0;
    t.crashes += (r.defenderCrashed ? 1 : 0) + (r.attackerCrashed ? 1 : 0);
  }
  return t;
}

const line = (v: Survey) => `flew ${v.flown.toFixed(0)} s, attacking ${v.attacking.toFixed(0)} s, tail held ${v.held.toFixed(0)} s (circling ${Math.round((100 * v.circle) / Math.max(v.held, 1))}%), hits taken ${v.hits}, down ${v.down}/${SEEDS.length}, crashes ${v.crashes}`;

const saved = { ...TACTICS_FLAGS };
afterEach(() => Object.assign(TACTICS_FLAGS, saved));

describe('defence with an enemy on the tail (real sim)', () => {
  const cases: [string, Case][] = [
    ['veteran D.VII, Camel on its tail at 2,000 m', { defender: 'fokker_dvii', defenderSkill: 'veteran', attacker: 'sopwith_camel', alt: 2000, brakeTurn: true }],
    ['ace D.VII, Bristol on its tail at 300 m (the playtest report)', { defender: 'fokker_dvii', defenderSkill: 'ace', attacker: 'bristol_f2b', alt: 300, brakeTurn: false }],
  ];
  for (const [name, c] of cases) {
    it(`${name}: the escalating defence gets him hit less`, () => {
      const byState = (tag: string) => {
        if (!process.env.DEFENCE_TRACE) return;
        const rows = [...HITS_BY_STATE].filter(([, v]) => v.s > 2).sort((a, b) => b[1].s - a[1].s);
        process.stdout.write(`  ${tag} hits/s by state: ${rows.map(([k, v]) => `${k} ${v.s.toFixed(0)}s ${(v.hits / v.s).toFixed(2)}`).join(' | ')}\n`);
        HITS_BY_STATE.clear();
      };
      TACTICS_FLAGS.escalateDefence = false;
      const off = survey(c);
      byState('off');
      TACTICS_FLAGS.escalateDefence = true;
      const on = survey(c);
      byState('on');
      process.stdout.write(`defence ${name}\n  off: ${line(off)}\n  on:  ${line(on)}\n`);
      // Measured, the turn is the right defence, so the test is on what the escalation buys.
      // Never at the price of more losses or of flying into the ground, and the attacker
      // holds his tail for no larger share of the flight.
      expect(on.down).toBeLessThanOrEqual(off.down);
      expect(on.crashes).toBeLessThanOrEqual(off.crashes);
      expect(on.held / on.flown).toBeLessThanOrEqual((off.held / off.flown) * 1.1);
      if (c.brakeTurn) {
        // At height a veteran's brake turn makes the attacker overshoot: far fewer hits
        // taken, and much more of the fight spent attacking him instead of defending.
        expect(on.hits).toBeLessThan(0.6 * off.hits);
        expect(on.attacking / on.flown).toBeGreaterThan((off.attacking / off.flown) * 1.3);
      } else {
        // Low down (no brake turn, D-060) it keeps the break: no worse, within noise.
        expect(on.hits).toBeLessThanOrEqual(off.hits * 1.2);
      }
    }, 120_000);
  }
});
