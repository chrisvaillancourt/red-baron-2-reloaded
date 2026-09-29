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

describe('CameraRig crew views', () => {
  const STATION_EYE = new Vector3(0, 1.3, 1.6);

  it('the gunner view sits at the station eye and looks along the gun', () => {
    const { world, player, rig } = setup(); // heading north
    rig.station = { eye: STATION_EYE, aimBody: new Vector3(0, 0, 1) }; // over the tail
    rig.setMode('gunner');
    run(rig, world, player, frame({}), 1);
    const look = new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    expect(look.z).toBeGreaterThan(0.99); // south, astern
    expect(rig.camera.position.distanceTo(player.state.position.clone().add(STATION_EYE))).toBeLessThan(0.05);
    expect(rig.inCockpit).toBe(true);
    expect(rig.inPilotCockpit).toBe(false);
  });

  it("a snap look turns the gunner's head off the gun while held", () => {
    const { world, player, rig } = setup();
    rig.station = { eye: STATION_EYE, aimBody: new Vector3(0, 0, 1) };
    rig.setMode('gunner');
    run(rig, world, player, frame({ snapLook: { yaw: Math.PI / 2, pitch: 0 } }), 2);
    const look = new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    expect(look.x).toBeLessThan(-0.95); // left of a northbound aircraft is west
  });

  it('a free look (right-drag, or the mouse with mouse aim off) turns the gunner\'s head until the gun swings', () => {
    const { world, player, rig } = setup(); // heading north
    rig.station = { eye: STATION_EYE, aimBody: new Vector3(0, 0, 1) }; // over the tail
    rig.setMode('gunner');
    run(rig, world, player, frame({}), 1);
    const look = () => new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    // Drag left 90°: from astern (south) the head turns to the east.
    run(rig, world, player, frame({ lookDelta: { yaw: Math.PI / 2 / 30, pitch: 0 } }), 0.5);
    run(rig, world, player, frame({}), 1);
    expect(look().x).toBeGreaterThan(0.95); // and it stays there, drag released
    // Swinging the gun hands the head back to it.
    rig.station.aimBody.set(0.05, 0, 1).normalize();
    run(rig, world, player, frame({}), 1);
    expect(look().z).toBeGreaterThan(0.99);
  });

  it('F1 at a gun (centre the head) ends the free look', () => {
    const { world, player, rig } = setup();
    rig.station = { eye: STATION_EYE, aimBody: new Vector3(0, 0, 1) };
    rig.setMode('gunner');
    run(rig, world, player, frame({ lookDelta: { yaw: 0.05, pitch: 0 } }), 0.5);
    rig.centreHead();
    run(rig, world, player, frame({}), 1);
    expect(new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion).z).toBeGreaterThan(0.99);
  });

  it('the bombsight looks straight down with the heading at the top', () => {
    const { world, player, rig } = setup();
    rig.station = { eye: STATION_EYE, aimBody: new Vector3(0, 0, 1) };
    rig.setMode('bombsight');
    run(rig, world, player, frame({}), 0.1);
    const look = new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion);
    expect(look.y).toBeLessThan(-0.999);
    expect(up.z).toBeLessThan(-0.999); // screen up = north = the nose
  });

  it('the gunner view needs a station; the bombsight works from the pilot eye too', () => {
    const { world, player, rig } = setup();
    rig.setMode('gunner');
    expect(rig.mode).toBe('cockpit');
    rig.setMode('bombsight');
    run(rig, world, player, frame({}), 0.1);
    expect(rig.mode).toBe('bombsight');
    expect(rig.camera.position.distanceTo(player.state.position.clone().add(EYE))).toBeLessThan(0.05);
  });
});
