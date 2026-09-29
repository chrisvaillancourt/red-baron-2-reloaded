import { describe, expect, it } from 'vitest';
import type { AircraftEntity, AircraftSpec } from '../core/types';
import { Autopilot } from './autopilot';
import { createAircraftEntity } from './entity';
import { SIM_DT, headingOf, stepFlight } from './flightModel';
import { TEST_TWIN } from './testing/fixtures';
import { count, scenario } from './testing/scenario';
import { flatEnv, realism } from './testUtil';

const R = realism({ autoRudder: false, engineTorque: false });

function twin(engines?: number[], spec: AircraftSpec = TEST_TWIN) {
  const env = flatEnv(50);
  const ac = createAircraftEntity({ id: 1, spec, env, start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 34 } });
  ac.controls.throttle = 1;
  if (engines) ac.damage.engines = [...engines];
  return { ac, env };
}

/** Fly `seconds`, hands off, or under an autopilot holding height and heading. */
function fly(ac: AircraftEntity, env: ReturnType<typeof flatEnv>, seconds: number, hold = false) {
  const ap = new Autopilot();
  for (let t = 0; t < seconds; t += SIM_DT) {
    if (hold) ap.update(ac, { altitude: 1500, heading: 0, throttle: 1 }, SIM_DT);
    stepFlight(ac, env, R, SIM_DT);
    env.advance(SIM_DT);
  }
}

/** Signed heading change, rad, positive to the right. */
const turned = (ac: AircraftEntity) => {
  const h = headingOf(ac.state.orientation);
  return h > Math.PI ? h - 2 * Math.PI : h;
};

describe('twin engines', () => {
  it('two engines split the power: healthy, the twin flies as a single-engined twin of the same power', () => {
    const single: AircraftSpec = { ...TEST_TWIN, id: 'test_twin_single' as AircraftSpec['id'], performance: { ...TEST_TWIN.performance, engineCount: 1 } };
    const a = twin();
    const b = twin(undefined, single);
    fly(a.ac, a.env, 40, true);
    fly(b.ac, b.env, 40, true);
    expect(Math.abs(a.ac.state.airspeed - b.ac.state.airspeed) / b.ac.state.airspeed).toBeLessThan(0.03);
    expect(Math.abs(turned(a.ac))).toBeLessThan(0.05);
  });

  it('a dead engine yaws the aircraft toward it', () => {
    const both = twin([0, 0]);
    const leftDead = twin([1, 0]);
    const rightDead = twin([0, 1]);
    for (const x of [both, leftDead, rightDead]) fly(x.ac, x.env, 8);
    const base = turned(both.ac);
    expect(turned(leftDead.ac) - base).toBeLessThan(-0.05);
    expect(turned(rightDead.ac) - base).toBeGreaterThan(0.05);
  });

  it('flies on the other engine, and glides with both dead', () => {
    const one = twin([1, 0]);
    const none = twin([1, 1]);
    none.ac.damage.engineDead = true;
    fly(one.ac, one.env, 30, true);
    fly(none.ac, none.env, 30, true);
    const sinkOne = 1500 - one.ac.state.position.y;
    const sinkNone = 1500 - none.ac.state.position.y;
    expect(one.ac.state.airspeed).toBeGreaterThan(25);
    expect(sinkOne).toBeLessThan(sinkNone / 2);
  });
});

describe('twin engine damage', () => {
  it('each engine takes its own damage; the engine zone holds the worst; both must die for engineDead', () => {
    const s = scenario();
    const t = s.add(1, TEST_TWIN, 0, 0, 1500);
    s.step(SIM_DT, undefined, false);
    expect(t.damage.engines).toEqual([0, 0]);
    s.combat.damageAircraft(t, 'engine', 1, 7, 0, 1);
    expect(t.damage.engines).toEqual([0, 1]);
    expect(t.damage.zones.engine).toBe(1);
    expect(t.damage.engineDead).toBe(false);
    s.step(0.1, undefined, false);
    expect(count(s.events, 'engine-dead')).toBe(0);
    s.combat.damageAircraft(t, 'engine', 1, 7, 0, 0);
    expect(t.damage.engineDead).toBe(true);
    s.step(0.1, undefined, false);
    expect(count(s.events, 'engine-dead')).toBe(1);
  });

  it('rounds into the right nacelle damage the right engine only', () => {
    const s = scenario({ realism: { gunJams: false } });
    const t = s.add(1, TEST_TWIN, 0, 0, 1000);
    // A Camel 150 m astern, lined up on the right nacelle; its sight line (0.8 m above its CG) on the engine.
    const camel = s.add(2, 'sopwith_camel', TEST_TWIN.geometry.nacelleOffsetX!, 150, 1000 - 0.1 - 0.8);
    camel.controller = 'none';
    camel.state.orientation.set(0, 0, 0, 1);
    camel.state.velocity.copy(t.state.velocity);
    t.state.orientation.set(0, 0, 0, 1);
    s.step(SIM_DT, undefined, 'kinematic');
    t.damage.crewWounds = [0, 1, 1]; // gunners silenced
    camel.controls.fireGuns = true;
    s.step(1.5, undefined, 'kinematic');
    expect(t.damage.engines![1]).toBeGreaterThan(0);
    expect(t.damage.engines![0]).toBe(0);
  });
});
