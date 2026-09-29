import { describe, expect, it } from 'vitest';
import { terrainHeightAt } from '../world/terrain';
import { AIRCRAFT, servedTogether } from '../data/aircraft';
import { buildQuickMission } from './quickMission';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { CloudField, SIGHT_MIN_TRANSMITTANCE } from '../world/clouds';
import { sideOfFrontAt } from '../world/frontline';
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition } from '../core/types';

describe('quick missions', () => {
  it('dates a matchup inside the shared service, or by the player\'s type when they never met', () => {
    const opts = { enemyCount: 1, wingmen: 0, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.4, type: 'dogfight' } as const;
    // Camel and D.V served together (from May 1917): dated inside both windows.
    expect(servedTogether(AIRCRAFT.sopwith_camel, AIRCRAFT.albatros_dv)).toBe(true);
    const met = buildQuickMission({ ...opts, playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv' }, 1).date;
    expect(met >= AIRCRAFT.albatros_dv.introduced && met <= AIRCRAFT.sopwith_camel.retired).toBe(true);
    // The N.11 was retired before the D.V arrived: dated mid-way through the N.11's service.
    expect(servedTogether(AIRCRAFT.nieuport_11, AIRCRAFT.albatros_dv)).toBe(false);
    expect(servedTogether(AIRCRAFT.albatros_dv, AIRCRAFT.nieuport_11)).toBe(false);
    const d = buildQuickMission({ ...opts, playerAircraft: 'nieuport_11', enemyAircraft: 'albatros_dv' }, 1).date;
    expect(d >= AIRCRAFT.nieuport_11.introduced && d <= AIRCRAFT.nieuport_11.retired).toBe(true);
  });

  it('a head-on quick dogfight starts with no cloud between the flights', () => {
    // Instant action promises a merge in ~25 s. With cloud on the line, 9 of 96 default fights
    // went more than 30 s before either side could see the other, and 8 went past 2 minutes.
    let blocked = 0;
    for (let r = 0; r < 96; r++) {
      const m = buildQuickMission({ ...QUICK_DEFAULTS }, 5000 + r * 131);
      const [p, e] = [m.flights.find((f) => f.role === 'player-flight')!, m.flights.find((f) => f.role === 'enemy')!];
      const tr = new CloudField(m.weather).transmittance(p.start.x, p.start.altitude, p.start.z, e.start.x, e.start.altitude, e.start.z, 0);
      if (tr < SIGHT_MIN_TRANSMITTANCE) blocked++;
      // Still a head-on start ~2.6 km apart, each flight on its own side of the lines.
      expect(Math.hypot(p.start.x - e.start.x, p.start.z - e.start.z)).toBeGreaterThan(2000);
      expect(sideOfFrontAt(p.start.x, p.start.z, m.date)).toBe(p.side);
      expect(sideOfFrontAt(e.start.x, e.start.z, m.date)).toBe(e.side);
    }
    expect(blocked).toBe(0);
  });

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

  describe('bombing raid', () => {
    const raid = (extra: Partial<QuickMissionOptions> = {}): QuickMissionOptions => ({
      type: 'bombing',
      playerAircraft: 'dh4',
      enemyAircraft: 'albatros_dv',
      enemyCount: 3,
      wingmen: 2,
      enemySkill: 'regular',
      wingmanSkill: 'regular',
      altitudeM: 2500,
      startPosition: 'head-on',
      timeOfDay: 'afternoon',
      cloudCover: 0.35,
      ...extra,
    });
    const speed = (id: AircraftId) => (AIRCRAFT[id].performance.maxSpeedKmh / 3.6) * 0.8;
    const bombWp = (m: MissionDefinition) => m.flights.find((f) => f.role === 'player-flight')!.waypoints.find((w) => w.action === 'bomb')!;

    it('bombs targets behind the enemy lines, with AA round them, then goes home', () => {
      for (let seed = 1; seed <= 12; seed++) {
        const m = buildQuickMission(raid(), seed);
        expect(m.type).toBe('bombing');
        const pf = m.flights.find((f) => f.role === 'player-flight')!;
        expect(pf.task).toBe('bomb');
        expect(sideOfFrontAt(pf.start.x, pf.start.z, m.date)).toBe(pf.side);
        const bombs = pf.waypoints.filter((w) => w.action === 'bomb');
        expect(bombs).toHaveLength(1);
        const wp = bombs[0];
        const targets = m.groundTargets.filter((g) => wp.targetIds!.includes(g.id));
        expect(targets.length).toBeGreaterThanOrEqual(2);
        for (const g of targets) {
          // Hangars, dumps, trains and batteries (with their lorries), never the flak.
          expect(['hangar', 'tent-hangar', 'supply-dump', 'train', 'artillery', 'truck']).toContain(g.type);
          expect(Math.hypot(g.x - wp.x, g.z - wp.z)).toBeLessThan(250);
        }
        for (const g of m.groundTargets) expect(sideOfFrontAt(g.x, g.z, m.date), `${seed} ${g.type}`).not.toBe(pf.side);
        // Behind the lines: well past the front, with a run-in from the start.
        const toFront = (p: { x: number; z: number }) => {
          let d = 0;
          const home = { x: pf.start.x - p.x, z: pf.start.z - p.z };
          const n = Math.hypot(home.x, home.z);
          while (d < n && sideOfFrontAt(p.x + (home.x / n) * d, p.z + (home.z / n) * d, m.date) !== pf.side) d += 100;
          return d;
        };
        expect(toFront(wp)).toBeGreaterThan(3000);
        expect(Math.hypot(wp.x - pf.start.x, wp.z - pf.start.z)).toBeGreaterThan(7000);
        const aa = m.groundTargets.filter((g) => g.type === 'aa-gun');
        expect(aa.length).toBeGreaterThanOrEqual(1);
        for (const g of aa) expect(Math.hypot(g.x - wp.x, g.z - wp.z)).toBeLessThan(1500);
        const obj = m.objectives.find((o) => o.primary)!;
        expect(obj.kind).toBe('destroy-ground');
        expect(obj.targetIds.every((id) => wp.targetIds!.includes(id))).toBe(true);
        expect(obj.count).toBeGreaterThanOrEqual(1);
        expect(obj.count).toBeLessThanOrEqual(obj.targetIds.length);
        // The way home: the route ends by landing on our side of the lines.
        const last = pf.waypoints[pf.waypoints.length - 1];
        expect(pf.waypoints.indexOf(wp)).toBeLessThan(pf.waypoints.length - 1);
        expect(last.action).toBe('land');
        expect(sideOfFrontAt(last.x, last.z, m.date)).toBe(pf.side);
      }
    });

    it('wingmen fly the player\'s bomber, and the player starts at his chosen station', () => {
      const m = buildQuickMission(raid({ playerStation: 'observer' }), 3);
      const pf = m.flights.find((f) => f.role === 'player-flight')!;
      expect(pf.aircraftId).toBe('dh4');
      expect(pf.members).toHaveLength(3);
      expect(pf.members[0]).toMatchObject({ isPlayer: true, station: 'observer' });
      expect(pf.members.slice(1).every((mm) => !mm.isPlayer && mm.station === undefined)).toBe(true);
      expect(buildQuickMission(raid(), 3).flights[0].members[0].station).toBeUndefined();
    });

    it('interceptors arrive during the run-in or over the target, not at the start', () => {
      for (const enemy of ['albatros_dv', 'fokker_dvii', 'pfalz_diiia'] as AircraftId[]) {
        for (let seed = 1; seed <= 8; seed++) {
          const m = buildQuickMission(raid({ enemyAircraft: enemy }), seed);
          const pf = m.flights.find((f) => f.role === 'player-flight')!;
          const wp = bombWp(m);
          const enemies = m.flights.filter((f) => f.role === 'enemy');
          expect(enemies.reduce((n, f) => n + f.members.length, 0)).toBe(3);
          const overTarget = Math.hypot(wp.x - pf.start.x, wp.z - pf.start.z) / speed('dh4');
          for (const f of enemies) {
            expect(f.aircraftId).toBe(enemy);
            expect(f.side).not.toBe(pf.side);
            // Nowhere near at the start.
            expect(Math.hypot(f.start.x - pf.start.x, f.start.z - pf.start.z)).toBeGreaterThan(8000);
            // They come to the run-in or the target, about when the bombers get there.
            const meet = f.waypoints[0];
            expect(Math.hypot(meet.x - wp.x, meet.z - wp.z)).toBeLessThan(4500);
            const arrive = (f.spawnDelay ?? 0) + Math.hypot(meet.x - f.start.x, meet.z - f.start.z) / speed(enemy);
            expect(arrive, `${enemy} ${seed}`).toBeGreaterThan(overTarget - 150);
            expect(arrive, `${enemy} ${seed}`).toBeLessThan(overTarget + 150);
          }
        }
      }
    });

    it('an optional escort of fighters of the player\'s side, of the chosen type or one in service', () => {
      expect(buildQuickMission(raid(), 5).flights.filter((f) => f.role === 'friendly')).toHaveLength(0);
      expect(buildQuickMission(raid({ escortCount: 0 }), 5).flights.filter((f) => f.role === 'friendly')).toHaveLength(0);
      for (let seed = 1; seed <= 6; seed++) {
        const m = buildQuickMission(raid({ escortCount: 3 }), seed);
        const esc = m.flights.filter((f) => f.role === 'friendly');
        expect(esc).toHaveLength(1);
        const e = esc[0];
        expect(e.task).toBe('escort');
        expect(e.escortFlightId).toBe('player-1');
        expect(e.members).toHaveLength(3);
        const spec = AIRCRAFT[e.aircraftId];
        expect(spec.role).toBe('fighter');
        expect(e.side).toBe('allied');
        expect(spec.introduced <= m.date && m.date <= spec.retired, `${e.aircraftId} on ${m.date}`).toBe(true);
        const pf = m.flights.find((f) => f.role === 'player-flight')!;
        expect(Math.hypot(e.start.x - pf.start.x, e.start.z - pf.start.z)).toBeLessThan(1500);
      }
      const chosen = buildQuickMission(raid({ escortCount: 2, escortAircraft: 'se5a' }), 2).flights.find((f) => f.role === 'friendly')!;
      expect(chosen.aircraftId).toBe('se5a');
      expect(chosen.members).toHaveLength(2);
    });

    it('is deterministic for a seed', () => {
      const o = raid({ escortCount: 2 });
      expect(buildQuickMission(o, 77)).toEqual(buildQuickMission(o, 77));
      expect(buildQuickMission(o, 77)).not.toEqual(buildQuickMission(o, 78));
    });

    it('starts with the bomb run clear of cloud', () => {
      // Like the head-on dogfight's clear start (D-082): the bomb aimer must see the target
      // from the run-in, when the formation gets there.
      let blocked = 0;
      for (let r = 0; r < 48; r++) {
        const m = buildQuickMission(raid({ cloudCover: 0.5 }), 5000 + r * 131);
        const pf = m.flights.find((f) => f.role === 'player-flight')!;
        const wp = bombWp(m);
        const clouds = new CloudField(m.weather);
        const run = { x: wp.x - pf.start.x, z: wp.z - pf.start.z };
        const n = Math.hypot(run.x, run.z);
        const gy = terrainHeightAt(wp.x, wp.z);
        for (const back of [1000, 2000, 3000]) {
          const p = { x: wp.x - (run.x / n) * back, z: wp.z - (run.z / n) * back };
          const t = (n - back) / speed('dh4');
          if (clouds.transmittance(p.x, wp.altitude, p.z, wp.x, gy + 5, wp.z, t) < SIGHT_MIN_TRANSMITTANCE) blocked++;
        }
      }
      expect(blocked).toBe(0);
    });
  });

  it('quick intercept: the intruders and the player converge on the intercept point together', () => {
    for (const [player, enemy] of [['fokker_eiii', 'fe2b'], ['albatros_dv', 'sopwith_camel'], ['sopwith_camel', 'rumpler_civ']] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const m = buildQuickMission(
          { playerAircraft: player, enemyAircraft: enemy, enemyCount: 2, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.4, type: 'intercept' },
          seed,
        );
        const pf = m.flights.find((f) => f.role === 'player-flight')!;
        const ef = m.flights.find((f) => f.role === 'enemy')!;
        const tgt = pf.waypoints[0];
        const dP = Math.hypot(pf.start.x - tgt.x, pf.start.z - tgt.z);
        const dE = Math.hypot(ef.start.x - tgt.x, ef.start.z - tgt.z);
        // Instant action: the flights start within about 10 km of each other, and neither
        // arrives at the intercept point minutes before the other.
        expect(Math.hypot(pf.start.x - ef.start.x, pf.start.z - ef.start.z)).toBeLessThan(10_500);
        expect(dE).toBeLessThan(5_500);
        expect(Math.abs(dE - dP)).toBeLessThan(2_500);
      }
    }
  });
});
