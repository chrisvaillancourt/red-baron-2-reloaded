import { Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BombView, WorldQuery } from '../../core/interfaces';
import { BombEffects, bombSize, craterRadius, MAX_DRAWN_BOMBS } from './bombEffects';
import { bombBurstSize } from './effectsSystem';

const world = { groundHeightAt: () => 0 } as unknown as WorldQuery;

function view(x: number, y: number, vx: number, vy: number, massKg = 50): BombView {
  return { position: new Vector3(x, y, 0), velocity: new Vector3(vx, vy, 0), storeIndex: 0, massKg, shooterId: 7, side: 'central', age: 1 };
}

const drawn = (fx: BombEffects) => fx.group.children.filter((c): c is Mesh => c.name === 'FallingBomb' && c.visible);

describe('bomb sizes', () => {
  it('sizes bombs, bursts and craters by mass and charge', () => {
    const b = bombSize(50);
    expect(b.length).toBeGreaterThan(1.2);
    expect(b.length).toBeLessThan(2.2);
    expect(craterRadius(50)).toBeGreaterThan(craterRadius(1.5));
    expect(bombBurstSize(23)).toBeGreaterThan(bombBurstSize(1.5));
    expect(bombBurstSize(50) / bombBurstSize(6.25)).toBeCloseTo(2, 5);
  });
});

describe('BombEffects', () => {
  it('draws each of the sim bombs where it is, nose along its velocity', () => {
    const fx = new BombEffects();
    const bombs = [view(0, 500, 40, -10), view(30, 300, 38, -60, 12.5)];
    fx.update(world, bombs);
    const meshes = drawn(fx);
    expect(meshes).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const m = meshes[i];
      expect(m.position.distanceTo(bombs[i].position)).toBeLessThan(1e-6);
      const nose = new Vector3(0, 0, 1).applyQuaternion(m.quaternion);
      expect(nose.angleTo(bombs[i].velocity)).toBeLessThan(1e-3);
    }
    // The small bomb is drawn smaller.
    expect(meshes[1].scale.z).toBeLessThan(meshes[0].scale.z);
    fx.dispose();
  });

  it('stops drawing a bomb once the sim no longer carries it', () => {
    const fx = new BombEffects();
    fx.update(world, [view(0, 500, 40, -10), view(0, 400, 40, -30)]);
    fx.update(world, [view(0, 480, 40, -12)]);
    expect(drawn(fx)).toHaveLength(1);
    expect(fx.fallingCount).toBe(1);
    fx.update(world);
    expect(drawn(fx)).toHaveLength(0);
    fx.dispose();
  });

  it('caps the bombs drawn at once', () => {
    const fx = new BombEffects();
    const many = Array.from({ length: MAX_DRAWN_BOMBS + 20 }, (_, i) => view(i * 5, 600, 40, -5));
    fx.update(world, many);
    expect(drawn(fx)).toHaveLength(MAX_DRAWN_BOMBS);
    fx.dispose();
  });

  it('plays a burst and leaves a crater when the sim reports one', () => {
    const fx = new BombEffects();
    let bursts = 0;
    fx.onBurst = () => bursts++;
    fx.handleEvent({ type: 'bomb-exploded', shooterId: 7, position: new Vector3(0, 0, -10), explosiveKg: 23, damagedTargetIds: [] });
    fx.update(world, []);
    expect(bursts).toBe(1);
    expect(fx.craterTotal).toBe(1);
    fx.dispose();
  });

  it('keeps a bounded ring of craters', () => {
    const fx = new BombEffects();
    for (let i = 0; i < 300; i++) fx.addCrater(i * 10, 0, 3, world);
    expect(fx.craterTotal).toBeGreaterThan(0);
    expect(fx.craterTotal).toBeLessThanOrEqual(128);
    fx.dispose();
  });
});
