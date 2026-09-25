import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { makeAircraft, TestWorld } from '../ai/testing/testWorld';
import { sunGlare } from './hudView';
import { AWARENESS_MEMORY_S, PlayerAwareness } from './playerAwareness';

const DEG = Math.PI / 180;
const SUN = new Vector3(Math.cos(30 * DEG), Math.sin(30 * DEG), 0); // east, 30° up
const EAST = Math.PI / 2;

function setup() {
  const world = new TestWorld({ sunDirection: SUN });
  const player = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 2000, heading: EAST, controller: 'player' });
  const p = SUN.clone().multiplyScalar(2500).add(player.state.position);
  const bouncer = makeAircraft({ side: 'central', x: p.x, z: p.z, alt: p.y, heading: -EAST });
  const other = makeAircraft({ side: 'central', x: -2000, z: 500, alt: 2100, heading: EAST });
  world.aircraft.push(player, bouncer, other);
  return { world, player, bouncer, other, aw: new PlayerAwareness() };
}

describe('player awareness (HUD fairness)', () => {
  it('does not know an enemy coming out of the sun until it is close', () => {
    const { world, player, bouncer, other, aw } = setup();
    aw.update(player, world);
    expect(aw.knows(other.id, world.time)).toBe(true);
    expect(aw.knows(bouncer.id, world.time)).toBe(false);
    // At 800 m a veteran-eyed human picks it out of the glare.
    bouncer.state.position.copy(SUN).multiplyScalar(800).add(player.state.position);
    world.time = 1;
    aw.update(player, world);
    expect(aw.knows(bouncer.id, world.time)).toBe(true);
  });

  it('knows a shooter, and whoever hit us, and forgets after a while', () => {
    const { world, player, bouncer, aw } = setup();
    // 1.5 km out of the sun: hidden in the glare.
    bouncer.state.position.copy(SUN).multiplyScalar(1500).add(player.state.position);
    aw.update(player, world);
    expect(aw.knows(bouncer.id, world.time)).toBe(false);
    // Out of range to be "attacking" (900 m), so firing alone does not give it away yet.
    bouncer.controls.fireGuns = true;
    world.time = 1;
    aw.update(player, world);
    expect(aw.knows(bouncer.id, world.time)).toBe(false);
    aw.onEvent({ type: 'bullet-hit', targetId: player.id, shooterId: bouncer.id, position: new Vector3(), zone: 'leftWing' }, player, 1);
    expect(aw.knows(bouncer.id, 1)).toBe(true);
    expect(aw.knows(bouncer.id, 1 + AWARENESS_MEMORY_S + 0.1)).toBe(false);
  });
});

describe('sun glare on the HUD', () => {
  it('sits on the sun when looking at it and is gone when looking away', () => {
    const world = new TestWorld({ sunDirection: SUN });
    const cam = new PerspectiveCamera(70, 16 / 9, 0.2, 60_000);
    cam.position.set(0, 2000, 0);
    cam.lookAt(cam.position.clone().add(SUN));
    cam.updateMatrixWorld();
    const g = sunGlare(cam, world);
    expect(g).toBeDefined();
    expect(g!.x).toBeCloseTo(0.5, 3);
    expect(g!.y).toBeCloseTo(0.5, 3);
    expect(g!.strength).toBeCloseTo(1);
    // 15° of a 70° vertical field of view: ~0.19 of the screen height.
    expect(g!.radius).toBeCloseTo(Math.tan(15 * DEG) / Math.tan(35 * DEG) / 2, 3);
    cam.lookAt(cam.position.clone().add(new Vector3(-1, 0, 0)));
    cam.updateMatrixWorld();
    expect(sunGlare(cam, world)).toBeUndefined();
    expect(sunGlare(cam, new TestWorld())).toBeUndefined();
  });
});
