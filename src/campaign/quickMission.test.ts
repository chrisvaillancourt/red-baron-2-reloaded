import { describe, expect, it } from 'vitest';
import { terrainHeightAt } from '../world/terrain';
import { buildQuickMission } from './quickMission';

describe('quick missions', () => {
  it('quick ground attack: defenders scramble low in two elements, the second later', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = buildQuickMission(
        { playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 3, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.4, type: 'ground-attack' },
        seed,
      );
      const els = m.flights.filter((f) => f.role === 'enemy');
      expect(els.map((f) => f.members.length)).toEqual([2, 1]);
      expect(els[1].spawnDelay!).toBeGreaterThan(els[0].spawnDelay!);
      for (const f of els) {
        // No height advantage over strafers working at 100-300 m.
        expect(f.start.altitude - terrainHeightAt(f.start.x, f.start.z)).toBeLessThan(450);
        // Not already over the target when they appear.
        const target = m.groundTargets[0];
        expect(Math.hypot(f.start.x - target.x, f.start.z - target.z)).toBeGreaterThan(5000);
      }
    }
  });
});
