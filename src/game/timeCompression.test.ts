import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { GroundTargetEntity } from '../core/types';
import { compressionBlock, ThreatWatch, type CompressionContext } from './timeCompression';

function ctx(o: Partial<CompressionContext> = {}): CompressionContext {
  return {
    playerSide: 'allied',
    position: new Vector3(0, 1500, 0),
    agl: 1500,
    sideOfGround: 'allied',
    groundTargets: [],
    nearestEnemyAir: Infinity,
    secondsSinceThreat: Infinity,
    ...o,
  };
}

function target(side: 'allied' | 'central', x: number, z: number, type: GroundTargetEntity['type'] = 'truck', destroyed = false): GroundTargetEntity {
  return { id: 1, kind: 'ground', type, side, position: new Vector3(x, 0, z), heading: 0, health: 1, destroyed };
}

describe('compressionBlock', () => {
  it('allows compression cruising high over friendly ground', () => {
    expect(compressionBlock(ctx())).toBeNull();
  });

  it('blocks when enemy aircraft are close (the existing rule)', () => {
    expect(compressionBlock(ctx({ nearestEnemyAir: 3000 }))).toBe('enemy-air');
  });

  it('blocks when low over enemy ground (trench fire), not when low over friendly ground', () => {
    expect(compressionBlock(ctx({ agl: 150, position: new Vector3(0, 150, 0), sideOfGround: 'central' }))).toBe('ground');
    expect(compressionBlock(ctx({ agl: 150, position: new Vector3(0, 150, 0), sideOfGround: 'allied' }))).toBeNull();
  });

  it('blocks when low near live enemy ground targets or AA, even over friendly ground', () => {
    const low = { agl: 250, position: new Vector3(0, 250, 0) };
    expect(compressionBlock(ctx({ ...low, groundTargets: [target('central', 1200, 0)] }))).toBe('ground');
    expect(compressionBlock(ctx({ ...low, groundTargets: [target('central', 1200, 0, 'truck', true)] }))).toBeNull();
    expect(compressionBlock(ctx({ ...low, groundTargets: [target('allied', 1200, 0)] }))).toBeNull();
    expect(compressionBlock(ctx({ ...low, groundTargets: [target('central', 6000, 0)] }))).toBeNull();
    // AA reaches further.
    expect(compressionBlock(ctx({ ...low, groundTargets: [target('central', 3500, 0, 'aa-gun')] }))).toBe('ground');
  });

  it('does not block high over enemy targets (flak alone is handled by the under-fire rule)', () => {
    expect(compressionBlock(ctx({ agl: 1500, sideOfGround: 'central', groundTargets: [target('central', 500, 0, 'aa-gun')] }))).toBeNull();
  });

  it('blocks for a few seconds after the player is threatened', () => {
    expect(compressionBlock(ctx({ secondsSinceThreat: 2 }))).toBe('under-fire');
    expect(compressionBlock(ctx({ secondsSinceThreat: 30 }))).toBeNull();
  });
});

describe('ThreatWatch', () => {
  const player = { id: 7, side: 'allied' as const, state: { position: new Vector3(0, 1500, 0) }, damage: { zones: { engine: 0, pilot: 0 } } };

  it('records hits on the player, silent damage, near flak and near-miss bullets', () => {
    const w = new ThreatWatch();
    w.update(player, [], 10);
    expect(w.secondsSince(10)).toBe(Infinity);

    w.onEvent({ type: 'bullet-hit', targetId: 7, shooterId: 3, position: new Vector3(), zone: 'engine' }, player, 11);
    expect(w.secondsSince(12)).toBeCloseTo(1);

    const w2 = new ThreatWatch();
    w2.update(player, [], 10);
    const hurt = { ...player, damage: { zones: { engine: 0.04, pilot: 0 } } };
    w2.update(hurt, [], 20); // trench fire damages without an event
    expect(w2.secondsSince(20)).toBe(0);

    const w3 = new ThreatWatch();
    w3.onEvent({ type: 'flak-burst', position: new Vector3(80, 1500, 0) }, player, 5);
    expect(w3.secondsSince(5)).toBe(0);
    const w4 = new ThreatWatch();
    w4.onEvent({ type: 'flak-burst', position: new Vector3(900, 1500, 0) }, player, 5);
    expect(w4.secondsSince(5)).toBe(Infinity);

    const w5 = new ThreatWatch();
    w5.update(player, [{ position: new Vector3(20, 1500, 0), side: 'central' }, { position: new Vector3(5, 1500, 0), side: 'allied' }], 3);
    expect(w5.secondsSince(3)).toBe(0);
    const w6 = new ThreatWatch();
    w6.update(player, [{ position: new Vector3(5, 1500, 0), side: 'allied' }], 3);
    expect(w6.secondsSince(3)).toBe(Infinity);
  });
});
