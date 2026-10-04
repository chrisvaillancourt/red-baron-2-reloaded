import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AircraftEntity, AircraftId } from '../core/types';
import type { SimFlightEnvironment } from './atmosphere';
import { Autopilot } from './autopilot';
import { getCoefficients } from './coefficients';
import { SIM_DT, isStoppedOnGround, pitchAngle, stepFlight } from './flightModel';
import { makeAircraft, realism } from './testUtil';
import { loadModelGeometry } from './testing/modelGeometry';

const twins = ['gotha_gv', 'handley_page_o400', 'aeg_giv'] as const;
const settings = realism({ engineTorque: false });

function run(ac: AircraftEntity, env: SimFlightEnvironment, seconds: number, each?: (t: number) => void) {
  for (let i = 0; i < seconds / SIM_DT; i++) {
    each?.(i * SIM_DT);
    stepFlight(ac, env, settings, SIM_DT);
    env.advance(SIM_DT);
  }
}

function modelGeometry(id: AircraftId) {
  const model = loadModelGeometry(id);
  return {
    mainL: model.point('Contact_WheelL'), mainR: model.point('Contact_WheelR'), tail: model.point('Contact_Skid'),
    wheels: model.vertices('Wheels'),
    airframe: ['Fuselage', 'Wing_Lower_L', 'Wing_Lower_R', 'PropBlades_L', 'PropBlades_R'].flatMap(name => model.vertices(name)),
  };
}

function rollResponse(id: AircraftId) {
  const { ac, env } = makeAircraft(id, { altitude: 1500, airspeed: 40, loaded: true });
  Object.assign(ac.controls, { roll: 0.5, throttle: 0.7 });
  run(ac, env, 0.5);
  expect(ac.outcome).toBeNull();
  expect(ac.state.stalled).toBe(false);
  return Math.abs(ac.state.angularVelocity.z);
}

describe('bomber flight readiness', () => {
  it('honours the low roll ratings in actual flight instead of flattening the twins to one response', () => {
    const gotha = rollResponse('gotha_gv');
    const o400 = rollResponse('handley_page_o400');
    const aeg = rollResponse('aeg_giv');
    expect(o400).toBeGreaterThan(0);
    expect(o400).toBeLessThan(gotha * 0.9);
    expect(gotha).toBeLessThan(aeg * 0.85);
    for (const fighter of ['sopwith_camel', 'albatros_dv', 'spad_xiii'] as const) {
      expect(rollResponse(fighter)).toBeGreaterThan(aeg * 2);
    }
  });

  it.each(twins)('%s spawns on the shipped wheels and skid, and rests without burying its wheels', (id) => {
    const model = modelGeometry(id);
    const { ac, env } = makeAircraft(id, { onGround: true, loaded: true });
    const gear = getCoefficients(ac.spec).gear;
    const supports = [model.mainL, model.mainR, model.tail];
    const expected = [new Vector3(-gear.halfTrack, gear.mainY, gear.mainZ), new Vector3(gear.halfTrack, gear.mainY, gear.mainZ), new Vector3(0, gear.tailY, gear.tailZ)];
    supports.forEach((point, i) => expect(point.distanceTo(expected[i])).toBeLessThan(0.001));
    // Independently confirm contact metadata sits on the wheel mesh, not its axle.
    expect(Math.abs(Math.min(...model.wheels.map(p => p.y)) - model.mainR.y)).toBeLessThan(0.001);
    for (const point of supports) {
      const y = point.clone().applyQuaternion(ac.state.orientation).add(ac.state.position).y - env.groundHeightAt(0, 0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(0.04);
    }
    ac.controls.throttle = 0;
    run(ac, env, 60);
    expect(ac.outcome).toBeNull();
    expect(isStoppedOnGround(ac)).toBe(true);
    expect(ac.state.angularVelocity.length()).toBeLessThan(0.01);
    for (const point of supports) {
      const y = point.clone().applyQuaternion(ac.state.orientation).add(ac.state.position).y - env.groundHeightAt(0, 0);
      expect(y).toBeGreaterThan(-0.12); // finite spring travel, not metre-deep visual burial
      expect(y).toBeLessThan(0.04);
    }
    const wheelClearance = Math.min(...model.wheels.map(p => p.clone().applyQuaternion(ac.state.orientation).add(ac.state.position).y - env.groundHeightAt(0, 0)));
    expect(wheelClearance).toBeGreaterThan(-0.15);
    const airframeClearance = Math.min(...model.airframe.map(p => p.clone().applyQuaternion(ac.state.orientation).add(ac.state.position).y - env.groundHeightAt(0, 0)));
    expect(airframeClearance).toBeGreaterThan(0);
  });

  it.each(twins)('%s rolls to a stable stop on its gear without damage', (id) => {
    const { ac, env } = makeAircraft(id, { onGround: true, loaded: true });
    ac.state.velocity.set(0, 0, -18);
    Object.assign(ac.controls, { throttle: 0, pitch: 0.5 });
    run(ac, env, 60);
    expect(ac.outcome).toBeNull();
    expect(isStoppedOnGround(ac)).toBe(true);
    expect(ac.state.angularVelocity.length()).toBeLessThan(0.01);
    expect(ac.damage.zones.leftWing).toBe(0);
    expect(ac.damage.zones.rightWing).toBe(0);
  });

  it.each(twins)('%s takes off from grass with its full bomb load and climbs clear', (id) => {
    const { ac, env } = makeAircraft(id, { onGround: true, loaded: true });
    const co = getCoefficients(ac.spec);
    const ap = new Autopilot();
    let airborneAt: number | undefined;
    run(ac, env, 120, (t) => {
      ac.controls.throttle = 1;
      if (ac.state.heightAboveGround > 6) {
        ap.update(ac, { airspeedByPitch: co.vBestClimbSL, heading: 0, throttle: 1 }, SIM_DT);
      } else {
        ac.controls.pitch = ac.state.airspeed < co.vStallSL * 1.2
          ? Math.max(-1, Math.min(1, (0.02 - pitchAngle(ac.state.orientation)) * 5 - ac.state.angularVelocity.x))
          : 0.3;
        ac.controls.roll = 0;
      }
      if (airborneAt === undefined && !ac.state.onGround && ac.state.heightAboveGround > 25) airborneAt = t;
    });
    expect(ac.outcome).toBeNull();
    expect(airborneAt).toBeDefined();
    expect(airborneAt!).toBeLessThan(90);
    expect(ac.state.onGround).toBe(false);
    expect(ac.state.heightAboveGround).toBeGreaterThan(75);
    expect(ac.state.stalled).toBe(false);
  });
});
