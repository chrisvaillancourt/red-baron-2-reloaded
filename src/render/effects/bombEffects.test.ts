import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, GameEvent } from '../../core/types';
import { AIRCRAFT } from '../../data/aircraft';
import { BombEffects, bombDragK, bombSize, craterRadius, stepBomb } from './bombEffects';
import { bombBurstSize } from './effectsSystem';

/** Drop from rest-relative level flight until the ground; returns the fall time and range. */
function drop(massKg: number, h: number, v: number, dt = 1 / 60) {
  const pos = new Vector3(0, h, 0);
  const vel = new Vector3(0, 0, -v);
  const k = bombDragK(massKg);
  let t = 0;
  while (pos.y > 0 && t < 120) {
    stepBomb(pos, vel, k, dt);
    t += dt;
  }
  return { t, range: -pos.z, vel };
}

function fakeWorld(entities: AircraftEntity[], ground = 0): WorldQuery {
  return {
    aircraft: entities,
    getEntity: (id: number) => entities.find((e) => e.id === id),
    groundHeightAt: () => ground,
  } as unknown as WorldQuery;
}

function gotha(id: number, y: number): AircraftEntity {
  return {
    id,
    kind: 'aircraft',
    spec: AIRCRAFT.gotha_gv,
    state: { position: new Vector3(0, y, 0), velocity: new Vector3(0, 0, -38) },
  } as unknown as AircraftEntity;
}

describe('bomb ballistics', () => {
  it('falls close to the vacuum time and keeps most of the release speed', () => {
    const vacuum = Math.sqrt((2 * 2000) / 9.81);
    for (const m of [11, 50, 104]) {
      const r = drop(m, 2000, 40);
      expect(r.t).toBeGreaterThan(vacuum);
      expect(r.t).toBeLessThan(vacuum * 1.08);
      expect(r.range).toBeGreaterThan(40 * r.t * 0.8);
      expect(r.range).toBeLessThan(40 * r.t);
    }
  });

  it('slows a small bomb more than a heavy one', () => {
    expect(bombDragK(11)).toBeGreaterThan(bombDragK(104));
    expect(drop(11, 2000, 40).range).toBeLessThan(drop(104, 2000, 40).range);
  });

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
  it('drops a bomb on release and takes it out at the ground', () => {
    const fx = new BombEffects();
    const world = fakeWorld([gotha(7, 300)]);
    const release: GameEvent = { type: 'bomb-released', aircraftId: 7, storeIndex: 0, position: new Vector3(0, 299, 0) };
    fx.handleEvent(release);
    fx.update(1 / 60, world);
    expect(fx.fallingCount).toBe(1);
    for (let i = 0; i < 60 * 12 && fx.fallingCount; i++) fx.update(1 / 60, world);
    // sqrt(2·299/9.81) ≈ 7.8 s of fall.
    expect(fx.fallingCount).toBe(0);
    fx.dispose();
  });

  it('removes the falling bomb and leaves a crater when the sim reports the burst', () => {
    const fx = new BombEffects();
    const world = fakeWorld([gotha(7, 300)]);
    fx.handleEvent({ type: 'bomb-released', aircraftId: 7, storeIndex: 0, position: new Vector3(0, 299, 0) });
    fx.update(1 / 60, world);
    let bursts = 0;
    fx.onBurst = () => bursts++;
    fx.handleEvent({ type: 'bomb-exploded', shooterId: 7, position: new Vector3(0, 280, -10), explosiveKg: 23, damagedTargetIds: [] });
    fx.update(1 / 60, world);
    expect(fx.fallingCount).toBe(0);
    expect(bursts).toBe(1);
    expect(fx.craterTotal).toBe(1);
    fx.dispose();
  });

  it('keeps a bounded ring of craters', () => {
    const fx = new BombEffects();
    const world = fakeWorld([]);
    for (let i = 0; i < 300; i++) fx.addCrater(i * 10, 0, 3, world);
    expect(fx.craterTotal).toBeGreaterThan(0);
    expect(fx.craterTotal).toBeLessThanOrEqual(128);
    fx.dispose();
  });
});
