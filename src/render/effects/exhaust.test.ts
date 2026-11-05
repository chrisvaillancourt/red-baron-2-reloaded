import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, AircraftId } from '../../core/types';
import { getAircraft } from '../../data/aircraft';
import { createAircraftEntity } from '../../sim/entity';
import { flatEnv } from '../../sim/testUtil';
import { EffectsSystem } from './effectsSystem';

function plane(id: AircraftId, x: number): AircraftEntity {
  const ac = createAircraftEntity({ id: 1, spec: getAircraft(id), env: flatEnv(), start: { x, z: 0, altitude: 1000, heading: 0, airspeed: 45 } });
  ac.state.engineRpm = 1200;
  return ac;
}

/** Fly `ac` straight ahead for `seconds` at 40 m/s and return the particles emitted. */
function fly(ac: AircraftEntity, camX: number, seconds = 1): number {
  const fx = new EffectsSystem(4000, () => 'allied');
  const cam = new PerspectiveCamera();
  cam.position.set(camX, 1000, 30);
  cam.updateMatrixWorld();
  const world = { aircraft: [ac], groundHeightAt: () => 0 } as unknown as WorldQuery;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    ac.state.position.z -= 40 * dt;
    fx.update(dt, cam, world, []);
  }
  return fx.activeCount;
}

describe('engine exhaust', () => {
  it('trails a running rotary near the camera, thicker than an inline at the same throttle', () => {
    const camel = plane('sopwith_camel', 0);
    const se5 = plane('se5a', 0);
    camel.controls.throttle = se5.controls.throttle = 0.6;
    const rotary = fly(camel, 0);
    const inline = fly(se5, 0);
    expect(rotary).toBeGreaterThan(5);
    expect(rotary).toBeGreaterThan(inline);
  });

  it('emits nothing far from the camera, with the engine stopped, or once the aircraft is down', () => {
    expect(fly(plane('sopwith_camel', 2000), 0)).toBe(0);
    const stopped = plane('sopwith_camel', 0);
    stopped.state.engineRpm = 0;
    expect(fly(stopped, 0)).toBe(0);
    const down = plane('sopwith_camel', 0);
    down.outcome = 'shot-down';
    expect(fly(down, 0)).toBe(0);
  });

  it('leaves a smoking aircraft to its damage trail', () => {
    const hit = plane('sopwith_camel', 0);
    hit.damage.smoking = true;
    // One damage puff per 4.5 m over 40 m; exhaust would add a dozen more.
    expect(fly(hit, 0)).toBeLessThanOrEqual(Math.ceil(40 / 4.5) + 1);
  });
});
