/**
 * Defence on the real flight model: an enemy parked on a veteran's tail. A pilot who only
 * repeats a level break toward the attacker chains the breaks into one flat circle, and the
 * attacker, turning inside him, stays there (the wave-9 playtest: "enemy pilots just fly in
 * circles when you get into position behind them"). The escalating defence
 * (TACTICS_FLAGS.escalateDefence, maneuvers.ts) is compared with the switch off on the same
 * seeds, against the veteran autoplayer and against the human-like pursuer (humanAim.ts).
 *
 * DEFENCE_AB=off,brake,ladder,mix prints one survey per defence and skips the assertions:
 * off is main before wave 9; brake the brake turn without the reversal; ladder
 * TACTICS_FLAGS.defenceLadder; mix the shipped default (brake turn and reversal).
 * AUTOPLAY_PILOT=human flies the A/B's attacker with the human-like aim. DEFENCE_SEEDS=N
 * changes the seed count (24). DEFENCE_TRACE=1 adds per-seed lines and hits per second by
 * defender state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AircraftId, SkillLevel } from '../core/types';
import { HUMAN_PILOT, humanPilotFromEnv, type HumanPilotParams } from './humanAim';
import { applyTacticsFlagsFromEnv, TACTICS_FLAGS } from './tactics';
import { runSim, SimWorld } from './testing/realSimHarness';
import { TailHoldTracker, zeroTailHold, type TailHoldAcc } from './testing/tailHold';

const SEEDS = Array.from({ length: Number(process.env.DEFENCE_SEEDS ?? 24) }, (_, i) => i + 1);
const HUMAN = humanPilotFromEnv(process.env);
const AB = (process.env.DEFENCE_AB ?? '').split(',').filter(Boolean);
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
  /** The attacker's fixed-gun rounds and hits on the defender. */
  rounds: number;
  fixedHits: number;
  defenderDown: boolean;
  defenderCrashed: boolean;
  attackerCrashed: boolean;
}

function flyCase(c: Case, seed: number, human: HumanPilotParams | undefined): Flown {
  const world = new SimWorld({ seed, frontX: -1e6, realFront: false });
  const heading = seed * 0.7;
  const fwd = { x: Math.sin(heading), z: -Math.cos(heading) };
  const def = world.addAircraft({ aircraftId: c.defender, side: 'central', x: 0, z: 0, alt: c.alt, heading });
  world.addAI(def, c.defenderSkill, { seed });
  const att = world.addAircraft({ aircraftId: c.attacker, side: 'allied', x: -fwd.x * 200, z: -fwd.z * 200, alt: c.alt + 10, heading });
  world.addAI(att, 'veteran', { seed: seed + 100, ...(human ? { human } : {}) });
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
  tr.finish();
  const fixed = (i: number | undefined) => att.spec.guns[i ?? 0]?.mount !== 'flexible';
  if (process.env.DEFENCE_TRACE) process.stdout.write(`  seed ${seed} ${c.defender}: t=${world.time.toFixed(0)} def=${def.outcome ?? 'flying'} att=${att.outcome ?? 'flying'} held=${(acc.get('def')?.held ?? 0).toFixed(0)} states=${[...(acc.get('def')?.states ?? [])].map(([k, v]) => `${k}:${v.toFixed(0)}`).join(',')}\n`);
  return {
    g: acc.get('def') ?? zeroTailHold(),
    attackingS,
    flownS: world.time,
    hitsTaken: world.eventsOf('bullet-hit').filter((e) => e.targetId === def.id).length,
    rounds: world.eventsOf('gun-fired').filter((e) => e.shooterId === att.id && fixed(e.mountIndex)).length,
    fixedHits: world.eventsOf('bullet-hit').filter((e) => e.shooterId === att.id && e.targetId === def.id && fixed(e.mountIndex)).length,
    defenderDown: !!def.outcome,
    // Flown into the ground untouched; a shot-up machine that crashes is a combat loss.
    defenderCrashed: def.outcome === 'crashed' && !world.eventsOf('bullet-hit').some((e) => e.targetId === def.id),
    attackerCrashed: att.outcome === 'crashed' && !world.eventsOf('bullet-hit').some((e) => e.targetId === att.id),
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
  rounds: number;
  fixedHits: number;
  down: number;
  crashes: number;
  episodes: number;
  kinds: number;
  longest: number;
}

function survey(c: Case, human = HUMAN): Survey {
  const t: Survey = { attacking: 0, flown: 0, held: 0, circle: 0, hits: 0, rounds: 0, fixedHits: 0, down: 0, crashes: 0, episodes: 0, kinds: 0, longest: 0 };
  for (const s of SEEDS) {
    const r = flyCase(c, s, human);
    t.held += r.g.held;
    t.attacking += r.attackingS;
    t.flown += r.flownS;
    t.circle += r.g.circle;
    t.hits += r.hitsTaken;
    t.rounds += r.rounds;
    t.fixedHits += r.fixedHits;
    t.down += r.defenderDown ? 1 : 0;
    t.crashes += (r.defenderCrashed ? 1 : 0) + (r.attackerCrashed ? 1 : 0);
    t.episodes += r.g.episodes;
    t.kinds += r.g.kindsSum;
    t.longest = Math.max(t.longest, r.g.longest);
  }
  return t;
}

const pct = (a: number, b: number) => Math.round((100 * a) / Math.max(b, 1e-9));
const line = (v: Survey) =>
  `flew ${v.flown.toFixed(0)} s, attacking ${v.attacking.toFixed(0)} s, tail held ${v.held.toFixed(0)} s (circling ${pct(v.circle, v.held)}%, varied ${100 - pct(v.circle, v.held)}%, ` +
  `${(v.kinds / Math.max(v.episodes, 1)).toFixed(2)} kinds/episode over ${v.episodes}, longest ${v.longest.toFixed(0)} s), hits taken ${v.hits}, down ${v.down}/${SEEDS.length}, unhit crashes ${v.crashes}, ` +
  `pursuer fixed guns ${v.fixedHits}/${v.rounds} (${pct(v.fixedHits, v.rounds)}%)`;

// AI_TACTICS (tactics.ts) sets the baseline every defence starts from.
applyTacticsFlagsFromEnv(process.env);
const saved = { ...TACTICS_FLAGS };
afterEach(() => Object.assign(TACTICS_FLAGS, saved));

/** Set the flags for one of DEFENCE_AB's defences. */
function setDefence(mode: string): void {
  Object.assign(TACTICS_FLAGS, saved);
  TACTICS_FLAGS.escalateDefence = mode !== 'off';
  TACTICS_FLAGS.defenceLadder = mode === 'ladder';
  TACTICS_FLAGS.defenceReversal = mode === 'mix';
  if (!['off', 'brake', 'ladder', 'mix'].includes(mode)) throw new Error(`DEFENCE_AB: unknown defence ${JSON.stringify(mode)}`);
}

const CASES: [string, Case][] = [
  ['veteran D.VII, Camel on its tail at 2,000 m', { defender: 'fokker_dvii', defenderSkill: 'veteran', attacker: 'sopwith_camel', alt: 2000, brakeTurn: true }],
  ['ace D.VII, Bristol on its tail at 300 m (the playtest report)', { defender: 'fokker_dvii', defenderSkill: 'ace', attacker: 'bristol_f2b', alt: 300, brakeTurn: false }],
];

const byState = (tag: string) => {
  if (!process.env.DEFENCE_TRACE) return;
  const rows = [...HITS_BY_STATE].filter(([, v]) => v.s > 2).sort((a, b) => b[1].s - a[1].s);
  process.stdout.write(`  ${tag} hits/s by state: ${rows.map(([k, v]) => `${k} ${v.s.toFixed(0)}s ${(v.hits / v.s).toFixed(2)}`).join(' | ')}\n`);
  HITS_BY_STATE.clear();
};

describe.skipIf(AB.length === 0)('defence A/B (DEFENCE_AB)', () => {
  for (const [name, c] of CASES) {
    it(`${name}: ${AB.join(' / ')}`, () => {
      const out = [`defence ${name}, pursuer ${HUMAN ? 'human-like' : 'veteran autoplayer'}, ${SEEDS.length} seeds`];
      for (const mode of AB) {
        setDefence(mode);
        out.push(`  ${mode.padEnd(6)} ${line(survey(c))}`);
        byState(mode);
      }
      process.stdout.write(out.join('\n') + '\n');
    }, 1_800_000);
  }
});

const varied = (v: Survey) => 1 - v.circle / Math.max(v.held, 1e-9);

describe.skipIf(AB.length > 0)('defence with an enemy on the tail (real sim)', () => {
  for (const [name, c] of CASES) {
    it(`${name}: the escalating defence breaks up the circle and gets him hit no more`, () => {
      const out = [`defence ${name}`];
      for (const [who, human] of [['veteran', undefined], ['human-like', HUMAN_PILOT]] as const) {
        setDefence('off');
        const off = survey(c, human);
        byState(`${who} off`);
        Object.assign(TACTICS_FLAGS, saved);
        const on = survey(c, human);
        byState(`${who} on`);
        out.push(`  ${who} pursuer, off: ${line(off)}`, `  ${who} pursuer, on:  ${line(on)}`);
        // Never at the price of more losses or of flying into the ground, and no more hits
        // taken than the old circle (within noise), against either pursuer.
        expect(on.down, who).toBeLessThanOrEqual(off.down);
        expect(on.crashes, who).toBeLessThanOrEqual(off.crashes);
        expect(on.hits, who).toBeLessThanOrEqual(off.hits * 1.25);
        if (c.brakeTurn) {
          // At height the brake turn makes the attacker overshoot: fewer hits taken, and more
          // of the fight spent attacking him. Against the human-like pursuer the reversal
          // breaks up the endless circle (against the veteran too over 24 seeds, 39 -> 49%,
          // but 8 seeds are within noise there).
          expect(on.hits, who).toBeLessThan(0.85 * off.hits);
          expect(on.attacking / on.flown, who).toBeGreaterThan((off.attacking / off.flown) * 1.3);
          if (human) expect(varied(on), who).toBeGreaterThan(varied(off));
        }
      }
      process.stdout.write(out.join('\n') + '\n');
    }, 240_000);
  }
});
