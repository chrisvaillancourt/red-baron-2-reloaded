import { describe, expect, it } from 'vitest';
import { declutter, visibleThreats, type DeclutterInput } from './declutter';

const at = (x: number, y: number, onScreen = true) => ({ x, y, onScreen });
const base: DeclutterInput = { w: 1280, h: 720, target: null, waypoint: null, aim: null, nose: null, reticle: null, combat: false };

describe('HUD declutter', () => {
  it('shows the waypoint and its label in quiet flight away from the centre cluster', () => {
    const r = declutter({ ...base, waypoint: at(0.8, 0.5), aim: at(0.5, 0.5), nose: at(0.5, 0.5) });
    expect(r.waypointOpacity).toBe(1);
    expect(r.waypointLabel).toBe(true);
  });

  it('hides the waypoint label when it sits on the aim ring (mission start, flying at the waypoint)', () => {
    const r = declutter({ ...base, waypoint: at(0.502, 0.51), aim: at(0.5, 0.5), nose: at(0.5, 0.5) });
    expect(r.waypointLabel).toBe(false);
    expect(r.waypointOpacity).toBe(1);
  });

  it('fades the waypoint in combat and removes it when the target box is on top of it', () => {
    expect(declutter({ ...base, combat: true, waypoint: at(0.2, 0.2), target: at(0.7, 0.5) }).waypointOpacity).toBeCloseTo(0.35);
    const r = declutter({ ...base, combat: true, waypoint: at(0.5, 0.52), target: at(0.51, 0.46) });
    expect(r.waypointOpacity).toBe(0);
    expect(r.waypointLabel).toBe(false);
  });

  it('merges the aim ring with the nose cross when aligned', () => {
    const r = declutter({ ...base, aim: at(0.5, 0.5), nose: at(0.505, 0.5) });
    expect(r.aimAligned).toBe(true);
    expect(r.showNose).toBe(false);
    const apart = declutter({ ...base, aim: at(0.6, 0.5), nose: at(0.5, 0.5) });
    expect(apart.aimAligned).toBe(false);
    expect(apart.showNose).toBe(true);
  });

  it('drops the nose cross when it sits on the gun reticle (chase view)', () => {
    const r = declutter({ ...base, aim: at(0.7, 0.4), nose: at(0.5, 0.5), reticle: at(0.505, 0.51) });
    expect(r.showNose).toBe(false);
    expect(r.showReticle).toBe(true);
  });

  it('lets the aligned aim ring replace the reticle when the aim sits on the gun line', () => {
    const r = declutter({ ...base, aim: at(0.5, 0.49), nose: at(0.5, 0.5), reticle: at(0.5, 0.505) });
    expect(r.aimAligned).toBe(true);
    expect(r.showReticle).toBe(false);
    expect(r.showNose).toBe(false);
  });

  it('flips the target text to the left when the box is right of centre', () => {
    expect(declutter({ ...base, target: at(0.8, 0.5) }).targetInfoLeft).toBe(true);
    expect(declutter({ ...base, target: at(0.4, 0.5) }).targetInfoLeft).toBe(false);
  });

  it('keeps off-screen and dangerous threats only', () => {
    const t = visibleThreats([
      { angle: 0, distance: 900, danger: false, onScreen: true },
      { angle: 1, distance: 900, danger: false, onScreen: false },
      { angle: 2, distance: 500, danger: true, onScreen: true },
    ]);
    expect(t.map((x) => x.angle)).toEqual([1, 2]);
  });
});
