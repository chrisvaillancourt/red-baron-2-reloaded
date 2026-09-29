import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, GameEvent } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { blastDamage, getBombStats, loadBombs, predictBombImpact } from './bombs';
import { createAircraftEntity } from './entity';
import { SIM_DT, stepFlight } from './flightModel';
import { TEST_TWIN } from './testing/fixtures';
import { count, scenario, type Scenario } from './testing/scenario';
import { flatEnv, realism } from './testUtil';

type Released = Extract<GameEvent, { type: 'bomb-released' }>;
type Exploded = Extract<GameEvent, { type: 'bomb-exploded' }>;
const released = (s: Scenario) => s.events.filter((e): e is Released => e.type === 'bomb-released');
const exploded = (s: Scenario) => s.events.filter((e): e is Exploded => e.type === 'bomb-exploded');

/** The loaded twin flying north level at `alt`, gunners silenced, no enemies. */
function bomber(opts: { alt?: number; wind?: [number, number, number] } = {}) {
  const s = scenario({ realism: { gunJams: false }, wind: opts.wind });
  const ac = s.add(1, TEST_TWIN, 0, 0, opts.alt ?? 1050);
  loadBombs(ac);
  return { s, ac };
}

const press = (s: Scenario, ac: AircraftEntity, hold = 0.2) => {
  ac.controls.releaseBomb = true;
  s.step(hold, undefined, 'kinematic');
  ac.controls.releaseBomb = false;
  s.step(0.1, undefined, 'kinematic');
};

describe('bomb load', () => {
  it('loadBombs fills the racks from the spec; a type without racks carries none', () => {
    const { ac } = bomber();
    expect(ac.bombs).toEqual([6, 1]);
    const camel = createAircraftEntity({ id: 2, spec: getAircraft('sopwith_camel'), env: flatEnv(), start: { x: 0, z: 0, altitude: 1000, heading: 0, airspeed: 45 } });
    expect(loadBombs(camel)).toBeUndefined();
    expect(camel.bombs).toBeUndefined();
  });

  it('the bomb load weighs the aircraft down until it goes', () => {
    // From the same state trimmed for the full load, a lighter aircraft rises: g x (mass off) / (mass).
    const riseWith = (bombs: number[] | undefined) => {
      const env = flatEnv(50);
      const ac = createAircraftEntity({ id: 1, spec: TEST_TWIN, env, start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 36 } });
      ac.bombs = bombs;
      ac.controls.throttle = 1;
      for (let t = 0; t < 0.25; t += SIM_DT) stepFlight(ac, env, realism(), SIM_DT);
      return ac.state.velocity.y;
    };
    const full = riseWith([6, 1]);
    const empty = riseWith([0, 0]);
    const off = 6 * 50 + 300;
    const expected = (0.25 * 9.81 * off) / (TEST_TWIN.performance.massLoaded - off);
    expect(empty - full).toBeGreaterThan(0.75 * expected);
    expect(empty - full).toBeLessThan(1.25 * expected);
    expect(riseWith(undefined)).toBeCloseTo(empty, 6);
    expect(riseWith([3, 1]) - full).toBeLessThan(0.5 * (empty - full));
  });
});

describe('bomb release', () => {
  it('releases one bomb per press, heaviest store first, from the aircraft', () => {
    const { s, ac } = bomber();
    const from = ac.state.position.clone();
    press(s, ac, 1);
    expect(released(s)).toHaveLength(1);
    expect(released(s)[0].storeIndex).toBe(1);
    expect(released(s)[0].aircraftId).toBe(1);
    expect(released(s)[0].position.distanceTo(from)).toBeLessThan(ac.state.velocity.length() * 2 * SIM_DT);
    press(s, ac);
    press(s, ac);
    expect(released(s).map((e) => e.storeIndex)).toEqual([1, 0, 0]);
    expect(ac.bombs).toEqual([4, 0]);
    expect(getBombStats(ac).dropped).toBe(3);
    expect(s.combat.bombs?.length).toBe(3);
  });

  it('the player at the bomb-aimer station releases; at a gun he cannot', () => {
    const { s, ac } = bomber();
    ac.controller = 'player';
    ac.stationInputs = { station: 'dorsal', aim: new Vector3(0, 0, 1), fire: false, releaseBomb: true, clearJam: false };
    s.step(0.3, undefined, 'kinematic');
    expect(released(s)).toHaveLength(0);
    ac.stationInputs = { station: 'observer', aim: new Vector3(0, -1, 0), fire: false, releaseBomb: false, clearJam: false };
    s.step(0.1, undefined, 'kinematic');
    ac.stationInputs.releaseBomb = true;
    s.step(0.3, undefined, 'kinematic');
    expect(released(s)).toHaveLength(1);
  });

  it('a dead bomb aimer releases nothing, and the AI cannot release for him; the player pilot still can', () => {
    const { s, ac } = bomber();
    s.step(SIM_DT, undefined, 'kinematic');
    ac.damage.crewWounds![1] = 1;
    ac.controller = 'player';
    ac.stationInputs = { station: 'observer', aim: new Vector3(0, -1, 0), fire: false, releaseBomb: false, clearJam: false };
    s.step(0.1, undefined, 'kinematic');
    ac.stationInputs.releaseBomb = true;
    s.step(0.3, undefined, 'kinematic');
    expect(released(s)).toHaveLength(0);
    // The AI flying it (the player at a gun) can't release for the dead aimer either.
    ac.stationInputs = undefined;
    ac.controller = 'ai';
    press(s, ac);
    expect(released(s)).toHaveLength(0);
    // The player in the pilot's seat pulls the release himself.
    ac.controller = 'player';
    press(s, ac);
    expect(released(s)).toHaveLength(1);
  });

  it('a dead pilot releases nothing', () => {
    const { s, ac } = bomber();
    ac.damage.pilotKilled = true;
    press(s, ac);
    expect(released(s)).toHaveLength(0);
  });

  it('no release on the ground or just above it', () => {
    const { s, ac } = bomber();
    ac.state.onGround = true;
    press(s, ac);
    ac.state.onGround = false;
    ac.state.heightAboveGround = 2;
    press(s, ac, SIM_DT);
    expect(released(s)).toHaveLength(0);
  });

  it('nothing to release when the racks are empty or were never loaded', () => {
    const { s, ac } = bomber();
    ac.bombs = undefined;
    press(s, ac);
    ac.bombs = [0, 0];
    press(s, ac);
    expect(released(s)).toHaveLength(0);
  });
});

describe('bomb ballistics and blast', () => {
  it('falls about as far as a vacuum drop, a little short from drag, and lands where predicted', () => {
    const { s, ac } = bomber({ alt: 1050 });
    const v = ac.state.velocity.length();
    const start = ac.state.position.clone();
    const predicted = predictBombImpact(ac, s.env)!;
    expect(predicted).not.toBeNull();
    press(s, ac, SIM_DT);
    s.step(20, undefined, 'kinematic');
    const burst = exploded(s)[0];
    expect(burst).toBeDefined();
    const tVac = Math.sqrt((2 * 1000) / 9.81);
    const range = Math.hypot(burst.position.x - start.x, burst.position.z - start.z);
    expect(range).toBeLessThan(v * tVac);
    expect(range).toBeGreaterThan(0.9 * v * tVac);
    expect(burst.position.y).toBeCloseTo(50, 0);
    expect(Math.hypot(burst.position.x - predicted.point.x, burst.position.z - predicted.point.z)).toBeLessThan(2);
    expect(predicted.time).toBeGreaterThan(tVac);
    expect(predicted.time).toBeLessThan(tVac * 1.1);
  });

  it('the wind drifts a falling bomb downwind', () => {
    const calm = bomber({ alt: 2050 });
    const windy = bomber({ alt: 2050, wind: [15, 0, 0] });
    // Same ground track: give both the same world velocity.
    windy.ac.state.velocity.copy(calm.ac.state.velocity);
    const a = predictBombImpact(calm.ac, calm.s.env)!;
    const b = predictBombImpact(windy.ac, windy.s.env)!;
    expect(b.point.x - a.point.x).toBeGreaterThan(1);
  });

  it('the blast destroys a target it lands on, with credit, and spares one far away', () => {
    const { s, ac } = bomber({ alt: 1050 });
    const at = predictBombImpact(ac, s.env)!.point;
    const near = s.addGround(60, 'truck', at.x + 3, at.z, 'allied');
    const far = s.addGround(61, 'truck', at.x + 150, at.z, 'allied');
    ac.side = 'central';
    press(s, ac, SIM_DT);
    s.step(20, undefined, 'kinematic');
    expect(near.destroyed).toBe(true);
    expect(far.health).toBe(1);
    const kill = s.events.find((e) => e.type === 'ground-destroyed');
    expect(kill?.type === 'ground-destroyed' && kill.killerId).toBe(1);
    expect(exploded(s)[0].damagedTargetIds).toEqual([60]);
    expect(exploded(s)[0].shooterId).toBe(1);
    expect(exploded(s)[0].explosiveKg).toBe(150);
    expect(count(s.events, 'explosion')).toBeGreaterThanOrEqual(2);
    expect(getBombStats(ac)).toEqual({ dropped: 1, hits: 1 });
    expect(s.combat.bombs?.length).toBe(0);
  });

  it('a near miss on a friendly target damages it but is not a bomb hit', () => {
    const { s, ac } = bomber({ alt: 1050 });
    const at = predictBombImpact(ac, s.env)!.point;
    const own = s.addGround(62, 'hangar', at.x + 20, at.z, 'central');
    press(s, ac, SIM_DT);
    s.step(20, undefined, 'kinematic');
    expect(own.health).toBeLessThan(1);
    expect(getBombStats(ac)).toEqual({ dropped: 1, hits: 0 });
  });

  it('a bomb still falling when its time runs out is discarded, not burst', () => {
    const { s, ac } = bomber({ alt: 3050 });
    press(s, ac, SIM_DT);
    const b = s.combat.bombs![0] as { age: number };
    b.age = 119.95;
    s.step(0.2, undefined, 'kinematic');
    expect(s.combat.bombs).toHaveLength(0);
    expect(exploded(s)).toHaveLength(0);
    expect(count(s.events, 'explosion')).toBe(0);
  });

  it('blast damage scales with charge and distance', () => {
    expect(blastDamage('truck', 0, 20)).toBe(1);
    expect(blastDamage('truck', 5, 20)).toBe(1);
    expect(blastDamage('truck', 15, 20)).toBeGreaterThan(0);
    expect(blastDamage('truck', 15, 20)).toBeLessThan(1);
    expect(blastDamage('truck', 60, 20)).toBe(0);
    // Four times the distance needs 64 times the charge for the same effect (cube-root scaling).
    expect(blastDamage('hangar', 40, 20 * 64)).toBeCloseTo(blastDamage('hangar', 10, 20), 6);
    // Harder targets need a closer burst.
    expect(blastDamage('artillery', 12, 20)).toBeLessThan(blastDamage('truck', 12, 20));
  });
});
