import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FireArc } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { bodyDirectionAngles, crewStations, inFireArcs, NOSE_GUNNER_ARCS, REAR_OBSERVER_ARCS } from '../data/crew';
import {
  aimBodyVector,
  arcBoundary,
  bombAimerStation,
  clampToArcs,
  cycleStation,
  initialAim,
  StationAim,
  startStation,
  stationInputsFor,
} from './crewSeat';

const bristol = getAircraft('bristol_f2b');
const camel = getAircraft('sopwith_camel');
const dh4 = getAircraft('dh4');
const fe2b = getAircraft('fe2b');

const angleBetween = (az1: number, el1: number, az2: number, el2: number) => {
  const a = aimBodyVector(az1, el1, new Vector3());
  const b = aimBodyVector(az2, el2, new Vector3());
  return (a.angleTo(b) * 180) / Math.PI;
};

describe('seat cycling', () => {
  it('cycles pilot, observer, pilot forward and back on a two-seater', () => {
    const st = crewStations(bristol);
    expect(cycleStation(st, 'pilot', 1)).toBe('observer');
    expect(cycleStation(st, 'observer', 1)).toBe('pilot');
    expect(cycleStation(st, 'pilot', -1)).toBe('observer');
    expect(cycleStation(st, 'observer', -1)).toBe('pilot');
  });

  it('stays in the pilot seat of a single-seater', () => {
    const st = crewStations(camel);
    expect(cycleStation(st, 'pilot', 1)).toBe('pilot');
    expect(cycleStation(st, 'pilot', -1)).toBe('pilot');
  });

  it('starts at the requested station when the type has it, else the pilot', () => {
    expect(startStation(bristol, 'observer')).toBe('observer');
    expect(startStation(bristol, undefined)).toBe('pilot');
    expect(startStation(camel, 'observer')).toBe('pilot');
    expect(startStation(bristol, 'ventral')).toBe('pilot');
  });

  it('finds the bomb aimer: the D.H.4 observer, none on the Bristol', () => {
    expect(bombAimerStation(dh4)?.id).toBe('observer');
    expect(bombAimerStation(bristol)).toBeUndefined();
  });
});

describe('aim clamping to fields of fire', () => {
  it('leaves an aim inside the arcs alone', () => {
    const c = clampToArcs(REAR_OBSERVER_ARCS, 180, 15);
    expect(c.limited).toBe(false);
    expect(c.azimuthDeg).toBeCloseTo(180, 6);
    expect(c.elevationDeg).toBeCloseTo(15, 6);
  });

  it('pulls an aim outside the arcs onto the nearest edge', () => {
    // Dead ahead and level: the observer can't fire through the propeller and upper wing.
    const c = clampToArcs(REAR_OBSERVER_ARCS, 0, 0);
    expect(c.limited).toBe(true);
    const v = aimBodyVector(c.azimuthDeg, c.elevationDeg, new Vector3());
    expect(inFireArcs(REAR_OBSERVER_ARCS, v.x, v.y, v.z)).toBe(true);
    // The nearest edge is the upper box's floor, 30 degrees up, or a beam box's forward side.
    expect(angleBetween(0, 0, c.azimuthDeg, c.elevationDeg)).toBeLessThanOrEqual(57.5);
  });

  it('picks the nearest of the boxes, by angle on the sphere', () => {
    // 20 degrees below the tail: the astern box's floor (7 deg up) is nearest, not a beam box.
    const c = clampToArcs(REAR_OBSERVER_ARCS, 175, -20);
    expect(c.limited).toBe(true);
    expect(c.elevationDeg).toBeCloseTo(7, 3);
    expect(Math.abs(c.azimuthDeg)).toBeGreaterThan(143);
  });

  it('never leaves the arcs, over a sweep of the whole sphere', () => {
    for (const arcs of [REAR_OBSERVER_ARCS, NOSE_GUNNER_ARCS]) {
      for (let az = -180; az < 180; az += 7) {
        for (let el = -89; el <= 89; el += 7) {
          const c = clampToArcs(arcs, az, el);
          const v = aimBodyVector(c.azimuthDeg, c.elevationDeg, new Vector3());
          expect(inFireArcs(arcs, v.x, v.y, v.z), `az ${az} el ${el}`).toBe(true);
          const inside = inFireArcs(arcs, ...aimBodyVector(az, el, new Vector3()).toArray());
          expect(c.limited).toBe(!inside);
        }
      }
    }
  });

  it('slides along an edge when the mouse pushes past it', () => {
    const aim = new StationAim(REAR_OBSERVER_ARCS, 90, 10);
    aim.move(0, -60); // push down, below the beam box's floor (-20)
    expect(aim.elevationDeg).toBeCloseTo(-20, 3);
    expect(aim.limited).toBe(true);
    aim.move(20, 0); // then sweep aft along the floor
    expect(aim.azimuthDeg).toBeCloseTo(110, 3);
    expect(aim.elevationDeg).toBeCloseTo(-20, 3);
    aim.move(0, 30); // back inside
    expect(aim.limited).toBe(false);
  });

  it('keeps the azimuth in (-180, 180] across astern', () => {
    const aim = new StationAim(REAR_OBSERVER_ARCS, 170, 15);
    aim.move(20, 0);
    expect(aim.azimuthDeg).toBeCloseTo(-170, 3);
  });
});

describe('initial aim', () => {
  it('starts the Bristol observer over the tail and the F.E.2b nose gunner ahead, both in their arcs', () => {
    const rear = initialAim(REAR_OBSERVER_ARCS);
    expect(Math.abs(rear.azimuthDeg)).toBeGreaterThan(140);
    const nose = initialAim(NOSE_GUNNER_ARCS);
    expect(Math.abs(nose.azimuthDeg)).toBeLessThan(30);
    for (const [arcs, a] of [[REAR_OBSERVER_ARCS, rear], [NOSE_GUNNER_ARCS, nose]] as const) {
      const v = aimBodyVector(a.azimuthDeg, a.elevationDeg, new Vector3());
      expect(inFireArcs(arcs, v.x, v.y, v.z)).toBe(true);
    }
    expect(crewStations(fe2b)[1].arcs).toEqual(NOSE_GUNNER_ARCS);
  });
});

describe('aim vectors', () => {
  it('round-trips azimuth and elevation through the body frame', () => {
    for (const [az, el] of [[0, 0], [90, 10], [-120, -15], [180, 40], [45, 80]]) {
      const v = aimBodyVector(az, el, new Vector3());
      expect(v.length()).toBeCloseTo(1, 9);
      const back = bodyDirectionAngles(v.x, v.y, v.z);
      expect(angleBetween(back.azimuthDeg, back.elevationDeg, az, el)).toBeLessThan(1e-6);
    }
    // 0 = the nose (-Z), +90 = the right wing (+X).
    expect(aimBodyVector(0, 0, new Vector3()).z).toBeCloseTo(-1, 9);
    expect(aimBodyVector(90, 0, new Vector3()).x).toBeCloseTo(1, 9);
  });
});

describe('arc edges for the HUD', () => {
  function boundaryIsReal(arcs: readonly FireArc[]) {
    const lines = arcBoundary(arcs);
    expect(lines.length).toBeGreaterThan(0);
    let n = 0;
    for (const line of lines)
      for (const [az, el] of line) {
        // Every edge point has inside and outside within a degree or so of it.
        const near: boolean[] = [];
        for (const [da, de] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
          const v = aimBodyVector(az + da, Math.max(-89.9, Math.min(89.9, el + de)), new Vector3());
          near.push(inFireArcs(arcs, v.x, v.y, v.z));
        }
        expect(near.some((x) => x) && near.some((x) => !x), `edge point ${az}, ${el}`).toBe(true);
        n++;
      }
    return n;
  }

  it('traces only the outer edge of the observer arcs (no seams between boxes)', () => {
    boundaryIsReal(REAR_OBSERVER_ARCS);
    // The seam at 30 degrees up between the top box and a beam box is inside the union.
    const seam = arcBoundary(REAR_OBSERVER_ARCS).flat().filter(([az, el]) => Math.abs(el - 30) < 0.01 && az > 70 && az < 130);
    expect(seam).toHaveLength(0);
  });

  it('traces the nose gunner arcs', () => {
    boundaryIsReal(NOSE_GUNNER_ARCS);
  });
});

describe('station inputs', () => {
  it('turns the body-frame aim into a world direction and passes fire, jam and release edges', () => {
    const st = crewStations(dh4)[1];
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // nose west
    const aimBody = aimBodyVector(180, 0, new Vector3()); // over the tail
    const si = stationInputsFor(st, aimBody, q, { fire: true, releaseBomb: true, clearJam: true });
    expect(si.station).toBe('observer');
    // Nose west (-X): the tail points east (+X).
    expect(si.aim.x).toBeCloseTo(1, 6);
    expect(si.aim.length()).toBeCloseTo(1, 9);
    expect(si).toMatchObject({ fire: true, releaseBomb: true, clearJam: true });
  });

  it('never releases from a station that is not the bomb aimer', () => {
    const st = crewStations(bristol)[1];
    const si = stationInputsFor(st, aimBodyVector(180, 10, new Vector3()), new Quaternion(), { fire: false, releaseBomb: true, clearJam: false });
    expect(si.releaseBomb).toBe(false);
  });

  it('reuses the target object so the sim sees one live StationInputs', () => {
    const st = crewStations(bristol)[1];
    const first = stationInputsFor(st, aimBodyVector(180, 10, new Vector3()), new Quaternion(), { fire: false, releaseBomb: false, clearJam: false });
    const again = stationInputsFor(st, aimBodyVector(170, 10, new Vector3()), new Quaternion(), { fire: true, releaseBomb: false, clearJam: false }, first);
    expect(again).toBe(first);
    expect(first.fire).toBe(true);
  });
});
