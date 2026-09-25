import { describe, expect, it } from 'vitest';
import type { AircraftEntity, AircraftId, RealismSettings } from '../core/types';
import { Autopilot } from './autopilot';
import { getCoefficients } from './coefficients';
import { SIM_DT, getSimInternal, pitchAngle, headingOf, isStoppedOnGround, orientationFrom, stepFlight } from './flightModel';
import { makeAircraft, realism } from './testUtil';
import { createFlightEnvironment, type SimFlightEnvironment } from './atmosphere';

function run(ac: AircraftEntity, env: SimFlightEnvironment, r: RealismSettings, seconds: number, each?: (t: number) => void) {
  for (let t = 0; t < seconds; t += SIM_DT) {
    each?.(t);
    stepFlight(ac, env, r, SIM_DT);
    env.advance(SIM_DT);
  }
}

function unwrap(d: number) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

describe('stall and spin', () => {
  const stallEntry = (id: AircraftId, r: RealismSettings, rudder: number) => {
    const co = getCoefficients(makeAircraft(id).spec);
    const { ac, env } = makeAircraft(id, { altitude: 2500, airspeed: co.vStallSL * 1.25 });
    Object.assign(ac.controls, { throttle: 0, pitch: 1, yaw: rudder, roll: 0 });
    let stalled = false;
    let maxYaw = 0;
    run(ac, env, r, 8, () => {
      stalled ||= ac.state.stalled;
      maxYaw = Math.max(maxYaw, Math.abs(ac.state.angularVelocity.y));
    });
    return { ac, env, stalled, maxYaw };
  };

  it('stalls with full back stick in standard mode, not in relaxed mode', () => {
    expect(stallEntry('sopwith_camel', realism({ autoRudder: false }), 0).stalled).toBe(true);
    const relaxed = stallEntry('sopwith_camel', realism({ flightModel: 'relaxed' }), 0);
    expect(relaxed.stalled).toBe(false);
  });

  it('spins from an uncoordinated stall on authentic and recovers with opposite rudder and forward stick', () => {
    const r = realism({ flightModel: 'authentic', autoRudder: false, engineTorque: false });
    const { ac, env, maxYaw } = stallEntry('sopwith_camel', r, 1);
    expect(maxYaw).toBeGreaterThan(0.8);
    expect(getSimInternal(ac).spinning).toBe(true);
    Object.assign(ac.controls, { pitch: -0.6, yaw: -1, roll: 0 });
    run(ac, env, r, 3);
    Object.assign(ac.controls, { pitch: 0, yaw: 0 });
    run(ac, env, r, 6);
    expect(getSimInternal(ac).spinning).toBe(false);
    expect(Math.abs(ac.state.angularVelocity.y)).toBeLessThan(0.4);
    expect(ac.outcome).toBeNull();
  });

  it('does not spin in relaxed mode with the same inputs', () => {
    const { maxYaw, ac } = stallEntry('sopwith_camel', realism({ flightModel: 'relaxed', autoRudder: false }), 1);
    expect(getSimInternal(ac).spinning).toBe(false);
    expect(maxYaw).toBeLessThan(0.8);
  });
});

describe('rotary torque', () => {
  const turn = (dir: 1 | -1, torque: boolean) => {
    const { ac, env } = makeAircraft('sopwith_camel', { altitude: 1500, airspeed: 42 });
    const r = realism({ engineTorque: torque, autoRudder: false });
    const ap = new Autopilot();
    const h0 = headingOf(ac.state.orientation);
    let turned = 0;
    let prev = h0;
    run(ac, env, r, 12, () => {
      ap.update(ac, { bank: dir * 1.2, verticalSpeed: 0, throttle: 1 }, SIM_DT);
      ac.controls.yaw = 0;
      const h = headingOf(ac.state.orientation);
      turned += unwrap(h - prev);
      prev = h;
    });
    return Math.abs(turned);
  };

  it('turns right faster than left in a Camel with torque on, symmetric with it off', () => {
    const right = turn(1, true);
    const left = turn(-1, true);
    console.log('camel turn right/left', right, left);
    expect(right).toBeGreaterThan(left * 1.04);
    const r0 = turn(1, false);
    const l0 = turn(-1, false);
    expect(Math.abs(r0 / l0 - 1)).toBeLessThan(0.03);
  });

  it('yaws right hands-off under full power', () => {
    const { ac, env } = makeAircraft('sopwith_camel', { altitude: 1500, airspeed: 40 });
    Object.assign(ac.controls, { throttle: 1, pitch: 0, roll: 0, yaw: 0 });
    const h0 = headingOf(ac.state.orientation);
    run(ac, env, realism({ autoRudder: false }), 3);
    expect(unwrap(headingOf(ac.state.orientation) - h0)).toBeGreaterThan(0.02);
  });
});

describe('structural limits', () => {
  const dive = (id: AircraftId) => {
    const { ac, env } = makeAircraft(id, { altitude: 3500, airspeed: 45 });
    orientationFrom(0, -Math.PI / 4, 0, ac.state.orientation);
    ac.state.velocity.set(0, -45 * Math.SQRT1_2, -45 * Math.SQRT1_2);
    const ap = new Autopilot();
    const r = realism({ engineTorque: false });
    let maxV = 0;
    run(ac, env, r, 13, () => {
      if (ac.state.position.y > 900 && !ac.damage.structuralFailure) {
        ap.update(ac, { verticalSpeed: -ac.state.airspeed * Math.SQRT1_2, throttle: 1 }, SIM_DT);
      }
      maxV = Math.max(maxV, ac.state.airspeed);
    });
    return { ac, maxV };
  };

  it('an Albatros D.V sheds a wing in a steep power dive; a SPAD XIII survives it', () => {
    const alb = dive('albatros_dv');
    expect(alb.ac.damage.structuralFailure).toBe(true);
    expect(getSimInternal(alb.ac).failedPart).not.toBeNull();
    const spad = dive('spad_xiii');
    expect(spad.ac.damage.structuralFailure).toBe(false);
  });
});

describe('ground handling', () => {
  it('takes off from a grass field at full throttle', () => {
    const { ac, env } = makeAircraft('sopwith_camel', { onGround: true });
    expect(ac.state.onGround).toBe(true);
    const co = getCoefficients(ac.spec);
    const r = realism();
    let airborneAt = -1;
    const ap = new Autopilot();
    run(ac, env, r, 60, (t) => {
      ac.controls.throttle = 1;
      const v = ac.state.airspeed;
      if (ac.state.heightAboveGround > 6) {
        ap.update(ac, { airspeedByPitch: co.vBestClimbSL, heading: 0, throttle: 1 }, SIM_DT);
      } else {
        // Raise the tail to level, then rotate at 1.2 Vs.
        ac.controls.pitch = v < co.vStallSL * 1.2 ? Math.max(-1, Math.min(1, (0.02 - pitchAngle(ac.state.orientation)) * 5 - ac.state.angularVelocity.x)) : 0.3;
        ac.controls.roll = 0;
      }
      if (airborneAt < 0 && ac.state.heightAboveGround > 25) airborneAt = t;
    });
    expect(ac.outcome).toBeNull();
    expect(airborneAt).toBeGreaterThan(0);
    expect(airborneAt).toBeLessThan(40);
  });

  it('sits stable on its gear and rolls to a stop without crashing', () => {
    const { ac, env } = makeAircraft('albatros_dv', { onGround: true });
    ac.state.velocity.set(0, 0, -18);
    Object.assign(ac.controls, { throttle: 0, pitch: 0.5 });
    run(ac, env, realism(), 60);
    expect(ac.outcome).toBeNull();
    expect(isStoppedOnGround(ac)).toBe(true);
    expect(ac.state.onGround).toBe(true);
  });

  it('counts as stopped when parked in a breeze (ground speed, not airspeed)', () => {
    const { ac } = makeAircraft('rumpler_civ', { onGround: true });
    const windy = createFlightEnvironment(() => 50, { wind: [0, 0, 16], turbulence: 0 });
    ac.state.velocity.set(0, 0, -10);
    Object.assign(ac.controls, { throttle: 0, pitch: 0.3 });
    run(ac, windy, realism(), 40);
    expect(ac.outcome).toBeNull();
    expect(ac.state.airspeed).toBeGreaterThan(3);
    expect(isStoppedOnGround(ac)).toBe(true);
  });

  it('crashes when flown into the ground', () => {
    const { ac, env } = makeAircraft('spad_vii', { altitude: 80, airspeed: 50 });
    orientationFrom(0, -0.5, 0, ac.state.orientation);
    ac.state.velocity.set(0, -20, -45);
    Object.assign(ac.controls, { pitch: -0.3, throttle: 1 });
    run(ac, env, realism(), 10);
    expect(ac.outcome).toBe('crashed');
    expect(ac.damage.destroyed).toBe(true);
  });
});

describe('engine', () => {
  it('loses thrust when the engine is destroyed and blipping cuts a rotary', () => {
    const { ac, env } = makeAircraft('sopwith_camel', { altitude: 1500, airspeed: 45 });
    ac.controls.throttle = 1;
    const r = realism();
    run(ac, env, r, 2);
    expect(getSimInternal(ac).powerFrac).toBeGreaterThan(0.8);
    ac.controls.blip = true;
    run(ac, env, r, 0.2);
    expect(getSimInternal(ac).powerFrac).toBeLessThan(0.05);
    ac.controls.blip = false;
    ac.damage.zones.engine = 1;
    run(ac, env, r, 5);
    expect(ac.state.engineRpm).toBeLessThan(700);
  });
});
