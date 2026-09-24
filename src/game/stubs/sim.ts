/**
 * STUB flight model: kinematic "arcade" flight so the game loop runs before
 * src/sim lands. Velocity follows the nose; speed from a power/drag balance.
 * Replaced by src/sim via src/game/modules.ts.
 */
import { Quaternion, Vector3 } from 'three';
import type { SimModule } from '../../core/interfaces';
import type { AircraftEntity, FlightEnvironment, FlightState, Weather } from '../../core/types';

const G = 9.81;
const GEAR_H = 1.3;
const _q = new Quaternion();
const _v = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export function stubCreateFlightEnvironment(groundHeightAt: (x: number, z: number) => number, weather: Weather): FlightEnvironment {
  return {
    groundHeightAt,
    airDensityAt: (h) => 1.225 * Math.pow(1 - 2.2558e-5 * h, 4.2559),
    windAt: (_p, out) => out.set(weather.wind[0], weather.wind[1], weather.wind[2]),
    turbulence: weather.turbulence,
  };
}

export const stubSim: SimModule = {
  createFlightState(spec, start, env, onGround): FlightState {
    const gh = env.groundHeightAt(start.x, start.z);
    const y = onGround ? gh + GEAR_H : Math.max(start.altitude, gh + 50);
    const orientation = new Quaternion().setFromAxisAngle(Y, -start.heading);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(orientation);
    return {
      position: new Vector3(start.x, y, start.z),
      velocity: fwd.multiplyScalar(onGround ? 0 : start.airspeed),
      orientation,
      angularVelocity: new Vector3(),
      airspeed: onGround ? 0 : start.airspeed,
      altitude: y,
      heightAboveGround: y - gh,
      aoa: 0,
      sideslip: 0,
      gLoad: 1,
      engineRpm: 1100,
      fuelL: spec.performance.fuelCapacityL,
      onGround,
      stalled: false,
    };
  },

  stepFlight(ac: AircraftEntity, env, _realism, dt) {
    const s = ac.state;
    if (ac.outcome !== null && s.onGround) {
      s.velocity.set(0, 0, 0);
      s.airspeed = 0;
      return;
    }
    const p = ac.spec.performance;
    const vmax = p.maxSpeedKmh / 3.6;
    const c = ac.controls;
    const out = ac.damage.destroyed || ac.damage.pilotKilled || ac.damage.structuralFailure;
    const pitchIn = out ? -0.4 : c.pitch;
    const rollIn = out ? 0.7 : c.roll;
    const yawIn = out ? 0 : c.yaw;
    const throttle = ac.damage.engineDead || out || c.blip ? 0 : c.throttle;

    let speed = s.velocity.length();
    const authority = Math.min(1, speed / (vmax * 0.55));
    const fwd = _v.set(0, 0, -1).applyQuaternion(s.orientation);
    // Rates: pitch about +X (nose up), roll right = negative about +Z, yaw right = negative about +Y.
    const pitchRate = pitchIn * 1.3 * p.pitchRate * authority;
    const rollRate = -rollIn * 2.6 * p.rollRate * authority;
    const yawRate = -yawIn * 0.5 * authority;
    s.orientation.multiply(_q.setFromAxisAngle(X, pitchRate * dt));
    s.orientation.multiply(_q.setFromAxisAngle(Z, rollRate * dt));
    s.orientation.multiply(_q.setFromAxisAngle(Y, yawRate * dt));
    // Banked flight turns a little by itself (lift vector).
    const right = new Vector3(1, 0, 0).applyQuaternion(s.orientation);
    if (!s.onGround && speed > 10) {
      const bankRight = -right.y; // >0 when right wing low
      s.orientation.premultiply(_q.setFromAxisAngle(Y, -(G / speed) * bankRight * 0.6 * dt));
    }
    s.orientation.normalize();
    fwd.set(0, 0, -1).applyQuaternion(s.orientation);

    // Speed: thrust - drag - gravity along path.
    const thrustAcc = (throttle * p.enginePowerHp * 745.7 * 0.8) / (p.massLoaded * Math.max(speed, 15));
    const k = (p.enginePowerHp * 745.7 * 0.8) / (p.massLoaded * vmax * vmax * vmax);
    const accel = thrustAcc - k * speed * speed - G * fwd.y - (s.onGround ? 0.8 : 0);
    speed = Math.max(0, speed + accel * dt);
    const stallSpeed = vmax * 0.42;
    s.stalled = !s.onGround && speed < stallSpeed;
    s.velocity.copy(fwd).multiplyScalar(speed);
    if (s.stalled || out) {
      s.velocity.y -= out ? 14 : 12 * (1 - Math.min(1, speed / stallSpeed));
      if (s.stalled) s.orientation.premultiply(_q.setFromAxisAngle(right, -0.6 * dt)).normalize();
    }
    s.position.addScaledVector(s.velocity, dt);

    const gh = env.groundHeightAt(s.position.x, s.position.z);
    if (s.position.y <= gh + GEAR_H) {
      const bank = Math.asin(Math.max(-1, Math.min(1, right.y)));
      const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      const vy = s.velocity.y;
      if (!s.onGround && (vy < -5 || Math.abs(bank) > 0.5 || pitch < -0.25 || out)) {
        s.position.y = gh + 0.5;
        s.onGround = true;
        s.velocity.set(0, 0, 0);
        ac.outcome ??= ac.damage.lastAttackerId !== null || out ? 'shot-down' : 'crashed';
        ac.damage.destroyed = true;
      } else {
        s.onGround = true;
        s.position.y = gh + GEAR_H;
        if (s.velocity.y < 0) s.velocity.y = 0;
        // Settle nose onto the horizon while rolling.
        if (pitch < 0) s.orientation.premultiply(_q.setFromAxisAngle(right, -pitch * 0.5)).normalize();
        if (speed > stallSpeed * 1.05 && pitchIn > 0.2) s.onGround = false;
      }
    } else if (s.position.y > gh + GEAR_H + 0.5) {
      s.onGround = false;
    }

    s.airspeed = s.velocity.length();
    s.altitude = s.position.y;
    s.heightAboveGround = s.position.y - gh;
    s.gLoad = 1 + (pitchRate * speed) / G;
    s.engineRpm = ac.damage.engineDead ? 0 : 600 + 900 * throttle + speed * 3;
    s.angularVelocity.set(pitchRate, yawRate, rollRate);
  },
};
