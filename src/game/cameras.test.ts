import { MathUtils, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeAircraft, TestWorld } from '../ai/testing/testWorld';
import { AIM_LEAD_PITCH_UP, AIM_LEAD_YAW_MAX, CameraRig } from './cameras';
import type { InputFrame } from './input';

const EYE = new Vector3(0, 0.9, 0);
const deg = MathUtils.degToRad;

function frame(o: Partial<InputFrame>): InputFrame {
  return {
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false },
    commands: [],
    snapLook: null,
    lookDelta: { yaw: 0, pitch: 0 },
    aimDirection: null,
    manualOverride: false,
    ...o,
  };
}

/** Aim direction `yaw` left / `pitch` up of the nose of an aircraft heading north. */
function aimAt(yawDeg: number, pitchDeg: number): Vector3 {
  const p = deg(pitchDeg);
  const y = deg(yawDeg);
  return new Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

function setup() {
  const world = new TestWorld();
  const player = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, controller: 'player' });
  world.aircraft.push(player);
  return { world, player, rig: new CameraRig(70, 16 / 9) };
}

function run(rig: CameraRig, world: TestWorld, player: ReturnType<typeof makeAircraft>, input: InputFrame, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, player, world, EYE, input);
}

describe('CameraRig cockpit view with mouse-aim', () => {
  it('leads toward an aim point far above the nose by no more than the pitch limit', () => {
    const { world, player, rig } = setup();
    run(rig, world, player, frame({ aimDirection: aimAt(0, 50) }), 3);
    expect(rig.headPitch).toBeGreaterThan(AIM_LEAD_PITCH_UP * 0.8);
    expect(rig.headPitch).toBeLessThanOrEqual(AIM_LEAD_PITCH_UP + 1e-6);
  });

  it('leads toward an aim point far to the side by no more than the yaw limit', () => {
    const { world, player, rig } = setup();
    run(rig, world, player, frame({ aimDirection: aimAt(-95, 10) }), 3);
    expect(rig.headYaw).toBeLessThan(-AIM_LEAD_YAW_MAX * 0.8);
    expect(rig.headYaw).toBeGreaterThanOrEqual(-AIM_LEAD_YAW_MAX - 1e-6);
    expect(rig.headPitch).toBeLessThan(AIM_LEAD_PITCH_UP);
  });

  it('follows a small aim offset closely', () => {
    const { world, player, rig } = setup();
    run(rig, world, player, frame({ aimDirection: aimAt(4, 0) }), 3);
    expect(MathUtils.radToDeg(rig.headYaw)).toBeGreaterThan(3);
    expect(MathUtils.radToDeg(rig.headYaw)).toBeLessThan(4.1);
  });

  it('eases rather than snapping to the lead', () => {
    const { world, player, rig } = setup();
    run(rig, world, player, frame({ aimDirection: aimAt(0, 50) }), 0.1);
    expect(rig.headPitch).toBeLessThan(AIM_LEAD_PITCH_UP * 0.6);
  });

  it('keeps full free-look and padlock range', () => {
    const { world, player, rig } = setup();
    run(rig, world, player, frame({ aimDirection: aimAt(0, 50), lookDelta: { yaw: 0.05, pitch: 0.02 } }), 1);
    expect(rig.headYaw).toBeGreaterThan(deg(90));

    const s = setup();
    const enemy = makeAircraft({ side: 'central', x: 0, z: 0, alt: 2500, heading: 0 });
    s.world.aircraft.push(enemy);
    s.rig.padlockId = enemy.id;
    s.rig.setMode('padlock');
    run(s.rig, s.world, s.player, frame({ aimDirection: aimAt(0, 0) }), 2);
    expect(s.rig.headPitch).toBeGreaterThan(deg(80));
  });
});
