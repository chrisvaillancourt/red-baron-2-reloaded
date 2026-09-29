/**
 * The escalating defence's bookkeeping (maneuvers.ts DefenceStreak, controller.ts decide):
 * which manoeuvre counts as the next in a row against the same attacker, what the last one
 * was, and which way a reversal turns.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { AircraftEntity, AircraftId } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import type { AIPilot } from './controller';
import { chooseDefensive, DefenceStreak, type Maneuver } from './maneuvers';
import { makeRng } from './math';
import { makeSkillProfile } from './skill';
import { runSim, SimWorld } from './testing/realSimHarness';
import { traitsFor } from './traits';

const maneuver = (kind: Maneuver['kind'], side: 1 | -1, start: number, until: number): Maneuver => ({ kind, side, start, until, heading0: 0, nextReverse: 0, low: false });

describe('DefenceStreak', () => {
  it('counts the next manoeuvre against the same attacker from the end of the last, not its start', () => {
    const s = new DefenceStreak();
    expect(s.level(7, 0)).toBe(0);
    s.started(7, maneuver('extend', 1, 0, 9), 0);
    // An extension lasts 8 s or more: the next manoeuvre at its end is still the next in a row.
    expect(s.level(7, 9.5)).toBe(1);
    expect(s.level(8, 9.5)).toBe(0);
    expect(s.level(7, 9 + 8.5)).toBe(0);
  });

  it('remembers the last manoeuvre and the way it turned after it has ended', () => {
    const s = new DefenceStreak();
    const m = maneuver('spiral', 1, 0, 4);
    s.started(3, m, 0);
    // A jink or scissors changes side as it flies: the side it ended on is what counts.
    m.side = -1;
    expect(s.lastKind).toBe('spiral');
    expect(s.lastSide).toBe(-1);
  });
});

/** A level aircraft at `pos` pointing along `fwd`, flying at 50 m/s. */
function plane(id: AircraftId, pos: Vector3, fwd: Vector3): AircraftEntity {
  const f = fwd.clone().normalize();
  return {
    id: 1,
    kind: 'aircraft',
    spec: AIRCRAFT[id],
    state: { position: pos, velocity: f.clone().multiplyScalar(50), orientation: new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), f), airspeed: 50, heightAboveGround: 2000 },
  } as unknown as AircraftEntity;
}

describe('the reversal', () => {
  it("turns the other way from the last manoeuvre's turn, whatever the rotary torque bias", () => {
    // A Camel flying north with a lagging attacker behind and to its right: his nose points
    // behind the Camel, and he isn't closing (no brake turn).
    const self = plane('sopwith_camel', new Vector3(0, 2000, 0), new Vector3(0, 0, -1));
    const attPos = new Vector3(100, 2000, 150);
    const att = plane('sopwith_camel', attPos, new Vector3(0, 2000, 300).sub(attPos));
    att.state.velocity.set(0, 0, -50);
    const traits = traitsFor(self.spec);
    const profile = makeSkillProfile(0.7);
    for (const lastSide of [1, -1] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const m = chooseDefensive(self, att, traits, profile, 2000, 0, makeRng(seed), undefined, false, { level: 2, lastKind: 'break', lastSide, mode: 'brake', reversal: true });
        expect(m.kind).toBe('reversal');
        expect(m.side, `seed ${seed}, last side ${lastSide}`).toBe(-lastSide);
      }
    }
  });
});

describe('defence on the way home (real sim)', () => {
  it('flies each manoeuvre to its end instead of re-picking one every tick', () => {
    const world = new SimWorld({ seed: 3, frontX: -1e6, realFront: false });
    const def = world.addAircraft({ aircraftId: 'fokker_dvii', side: 'central', x: 0, z: 0, alt: 2000, heading: 0 });
    const ctl = world.addAI(def, 'veteran', { seed: 3 });
    // Heading home hurt (not a voluntary return: a fit fighter would turn and fight).
    (ctl as unknown as { startRtb(reason: string): void }).startRtb('damaged');
    const att = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: 200, alt: 2010, heading: 0 });
    world.addAI(att, 'veteran', { seed: 103 });
    const seen = new Set<unknown>();
    let rtbDefending = 0;
    runSim(world, 20, {
      onStep: () => {
        const c = ctl as unknown as { phase: AIPilot['phase']; maneuver: Maneuver | null };
        if (c.phase === 'rtb' && c.maneuver) {
          seen.add(c.maneuver);
          rtbDefending++;
        }
        return !!def.outcome;
      },
    });
    // It defends on the way home, and no manoeuvre is shorter than 2.5 s.
    expect(rtbDefending).toBeGreaterThan(120 * 5);
    expect(seen.size).toBeLessThanOrEqual(Math.ceil(rtbDefending / 120 / 2.5) + 1);
  });
});
