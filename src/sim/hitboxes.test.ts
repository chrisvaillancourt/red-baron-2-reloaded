import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { crewStations } from '../data/crew';
import { getHitModel, type ZoneBox } from './hitboxes';
import { TEST_TWIN } from './testing/fixtures';

const inside = (b: ZoneBox, p: readonly number[]) => [0, 1, 2].every((i) => p[i] >= b.min[i] && p[i] <= b.max[i]);

describe('hit boxes', () => {
  it('existing types keep one gunner box and one engine box, with no per-station or per-engine tags', () => {
    for (const spec of AIRCRAFT_LIST) {
      const hm = getHitModel(spec);
      expect(hm.zones.filter((z) => z.zone === 'engine'), spec.id).toHaveLength(1);
      expect(hm.zones.filter((z) => z.zone === 'gunner'), spec.id).toHaveLength(spec.geometry.crew >= 2 ? 1 : 0);
      for (const z of hm.zones) {
        expect(z.crewIndex, spec.id).toBeUndefined();
        expect(z.station, spec.id).toBeUndefined();
        expect(z.engineIndex, spec.id).toBeUndefined();
      }
    }
  });

  it('explicit stations get a gunner box each, at their guns, tagged with the crew member', () => {
    const hm = getHitModel(TEST_TWIN);
    const gunners = hm.zones.filter((z) => z.zone === 'gunner');
    const stations = crewStations(TEST_TWIN).filter((s) => s.crewIndex > 0);
    expect(gunners).toHaveLength(stations.length);
    for (const st of stations) {
      const box = gunners.find((z) => z.station === st.id)!;
      expect(box, st.id).toBeDefined();
      expect(box.crewIndex).toBe(st.crewIndex);
      const gun = TEST_TWIN.guns[st.guns[0]].position;
      // The man stands at his gun: the box spans its fore-aft position and lies within 1.5 m of it.
      expect(box.min[2]).toBeLessThanOrEqual(gun[2] + 0.36);
      expect(box.max[2]).toBeGreaterThanOrEqual(gun[2]);
      expect(Math.abs((box.min[1] + box.max[1]) / 2 - gun[1])).toBeLessThan(1.5);
    }
    // The nose gunner is well ahead of the rear gunner's two positions.
    const z = (id: string) => gunners.find((g) => g.station === id)!.min[2];
    expect(z('nose')).toBeLessThan(z('dorsal') - 3);
  });

  it('twins have an engine box on each nacelle and none in the nose', () => {
    const hm = getHitModel(TEST_TWIN);
    const engines = hm.zones.filter((z) => z.zone === 'engine');
    expect(engines).toHaveLength(2);
    const x = TEST_TWIN.geometry.nacelleOffsetX!;
    const left = engines.find((e) => e.engineIndex === 0)!;
    const right = engines.find((e) => e.engineIndex === 1)!;
    expect(inside(left, [-x, 0, (left.min[2] + left.max[2]) / 2])).toBe(true);
    expect(inside(right, [x, 0, (right.min[2] + right.max[2]) / 2])).toBe(true);
    expect(engines.some((e) => inside(e, [0, 0, (e.min[2] + e.max[2]) / 2]))).toBe(false);
  });
});
