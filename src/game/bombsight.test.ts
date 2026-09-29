import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { blastDamage, GROUND_TARGET_BOXES } from '../sim';
import { driftAngle, RELEASE_DAMAGE, releaseRadiusM, releaseSolution } from './bombsight';

describe('release radius', () => {
  it('is where the sim\'s blast falls to the release damage, measured from the target\'s centre', () => {
    for (const type of ['truck', 'hangar', 'artillery'] as const) {
      const r = releaseRadiusM(type, 20);
      const box = GROUND_TARGET_BOXES[type];
      const toFace = r - Math.min(box.hx, box.hz);
      expect(blastDamage(type, toFace - 0.1, 20)).toBeGreaterThanOrEqual(RELEASE_DAMAGE);
      expect(blastDamage(type, toFace + 0.1, 20)).toBeLessThan(RELEASE_DAMAGE);
    }
  });

  it('grows with the charge, is tighter on hard targets, and is nothing without a charge', () => {
    expect(releaseRadiusM('truck', 50)).toBeGreaterThan(releaseRadiusM('truck', 20));
    expect(releaseRadiusM('artillery', 20)).toBeLessThan(releaseRadiusM('truck', 20));
    expect(releaseRadiusM('truck', 0)).toBe(0);
  });
});

describe('release solution', () => {
  const impact = new Vector3(0, 0, -800);
  const groundVel = new Vector3(0, 0, -50);

  it('counts down to a target ahead on the track', () => {
    const s = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(0, 0, -1800), radiusM: 25 }]);
    expect(s.cue).toBe('run-in');
    expect(s.targetId).toBe(7);
    expect(s.alongM).toBeCloseTo(1000, 3);
    expect(s.timeToRelease).toBeCloseTo(20, 3);
  });

  it('says release when the target is under the predicted impact', () => {
    const s = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(10, 0, -805), radiusM: 25 }]);
    expect(s.cue).toBe('release');
  });

  it('says steer when the target is off the track, and past once it is behind', () => {
    const off = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(120, 0, -1400), radiusM: 25 }]);
    expect(off.cue).toBe('run-in');
    expect(off.crossM).toBeCloseTo(120, 3); // positive: right of the track
    const past = releaseSolution(impact, groundVel, [{ id: 7, position: new Vector3(0, 0, -600), radiusM: 25 }]);
    expect(past.cue).toBe('past');
  });

  it('uses each target\'s own radius', () => {
    const near = new Vector3(0, 0, -830);
    expect(releaseSolution(impact, groundVel, [{ id: 7, position: near, radiusM: 25 }]).cue).toBe('run-in');
    expect(releaseSolution(impact, groundVel, [{ id: 7, position: near, radiusM: 35 }]).cue).toBe('release');
  });

  it('picks the target nearest the track ahead, and none when nothing is near', () => {
    const s = releaseSolution(
      impact,
      groundVel,
      [
        { id: 1, position: new Vector3(600, 0, -1500), radiusM: 25 },
        { id: 2, position: new Vector3(40, 0, -2500), radiusM: 25 },
      ],
    );
    expect(s.targetId).toBe(2);
    expect(releaseSolution(impact, groundVel, [{ id: 3, position: new Vector3(5000, 0, 0), radiusM: 25 }]).cue).toBe('none');
    expect(releaseSolution(impact, groundVel, []).cue).toBe('none');
  });
});

describe('drift', () => {
  it('measures the drift between the heading and the ground track', () => {
    // Heading north, wind from the west pushing east: the track drifts right (positive).
    const heading = new Vector3(0, 0, -1);
    const d = driftAngle(heading, new Vector3(10, 0, -50));
    expect(d).toBeCloseTo(Math.atan2(10, 50), 6);
    expect(driftAngle(heading, new Vector3(0, 0, -50))).toBeCloseTo(0, 9);
  });
});
