/**
 * AI scenario tests on the REAL flight model and combat (src/sim): stepFlight at
 * 120 Hz, createCombatSystem, AI at 30 Hz. Standard realism, engine torque on.
 * Long soak runs live in tuning.soak.test.ts (AI_SOAK=...).
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, AircraftId, SkillLevel, Waypoint } from '../core/types';
import { AIRCRAFT_LIST, getAircraft } from '../data/aircraft';
import { getAerodrome } from '../data/aerodromes';
import { formationOffset, slotPosition } from './navigation';
import { runSim, SimWorld } from './testing/realSimHarness';
import { combatRun, routeFlight } from './testing/realScenarios';

const sideOf = (id: AircraftId) => (getAircraft(id).nation === 'germany' ? 'central' : 'allied');

describe('AI on the real flight model', { timeout: 60_000 }, () => {
  it('every type flies a route and a patrol orbit without stalling, crashing or losing height', () => {
    for (const spec of AIRCRAFT_LIST) {
      const side = sideOf(spec.id);
      const wps: Waypoint[] = [
        { x: 0, z: -5000, altitude: 1800, action: 'fly' },
        { x: 5000, z: -8000, altitude: 1500, action: 'fly' },
        { x: 8000, z: -3000, altitude: 1200, action: 'patrol', duration: 60 },
      ];
      const world = new SimWorld({ flights: [routeFlight('a', side, spec.id, wps)], frontX: side === 'allied' ? 60000 : -60000 });
      const ac = world.addAircraft({ aircraftId: spec.id, side, x: 0, z: 0, alt: 1500, heading: 0, flightId: 'a' });
      world.addAI(ac, 'regular');
      const minDist = wps.map(() => Infinity);
      let stalled = 0;
      let minAgl = Infinity;
      runSim(world, 480, {
        onStep: () => {
          const p = ac.state.position;
          wps.forEach((w, i) => (minDist[i] = Math.min(minDist[i], Math.hypot(w.x - p.x, w.z - p.z))));
          if (ac.state.stalled) stalled += 1 / 120;
          minAgl = Math.min(minAgl, ac.state.heightAboveGround);
        },
      });
      expect(ac.outcome, spec.id).toBeNull();
      expect(stalled, `${spec.id} stalled time`).toBeLessThan(2);
      expect(minAgl, spec.id).toBeGreaterThan(700);
      for (const d of minDist.slice(0, 2)) expect(d, spec.id).toBeLessThan(800);
    }
  });

  it('wingmen hold a vic formation through turns (mean slot error < 40 m)', () => {
    for (const id of ['se5a', 'albatros_dv', 'sopwith_camel', 'fokker_dri'] as AircraftId[]) {
      const side = sideOf(id);
      const wps: Waypoint[] = [
        { x: 0, z: -5000, altitude: 1500, action: 'fly' },
        { x: 5000, z: -8000, altitude: 1600, action: 'fly' },
        { x: 9000, z: -2000, altitude: 1500, action: 'fly' },
      ];
      const world = new SimWorld({ flights: [routeFlight('f', side, id, wps)], frontX: side === 'allied' ? 60000 : -60000 });
      const lead = world.addAircraft({ aircraftId: id, side, x: 0, z: 0, alt: 1500, heading: 0, flightId: 'f' });
      const wings = [1, 2].map((slot) => world.addAircraft({ aircraftId: id, side, x: formationOffset(slot).x, z: formationOffset(slot).z, alt: 1500, heading: 0, flightId: 'f' }));
      world.addAI(lead, 'regular');
      wings.forEach((w, i) => world.addAI(w, 'regular', { leaderId: lead.id, formationSlot: i + 1 }));
      let err = 0;
      let n = 0;
      const slot = new Vector3();
      runSim(world, 300, {
        onStep: (t) => {
          if (t < 30) return;
          wings.forEach((w, i) => {
            err += slotPosition(lead, formationOffset(i + 1), slot).distanceTo(w.state.position);
            n++;
          });
        },
      });
      for (const a of [lead, ...wings]) expect(a.outcome, id).toBeNull();
      expect(err / n, `${id} mean slot error`).toBeLessThan(40);
    }
  });

  it('flights take off, fly the mission, return and land at their home aerodrome', () => {
    for (const id of ['se5a', 'sopwith_camel', 'spad_xiii', 'bristol_f2b', 'albatros_dv', 'fokker_dri', 'fokker_dvii'] as AircraftId[]) {
      const side = sideOf(id);
      const home = getAerodrome(side === 'central' ? 'douai' : 'filescamp')!;
      const hdg = (home.runwayHeadingDeg * Math.PI) / 180;
      const out = side === 'central' ? -1 : 1;
      const wps: Waypoint[] = [
        { x: home.x + out * 6000, z: home.z - 2000, altitude: 1500, action: 'fly' },
        { x: home.x + out * 9000, z: home.z + 2000, altitude: 1500, action: 'patrol', duration: 60 },
      ];
      const world = new SimWorld({ flights: [routeFlight('f', side, id, wps)] });
      const lead = world.addAircraft({ aircraftId: id, side, x: home.x, z: home.z, alt: 50, heading: hdg, flightId: 'f', onGround: true });
      const wing = world.addAircraft({ aircraftId: id, side, x: home.x + Math.cos(hdg) * 25, z: home.z + Math.sin(hdg) * 25, alt: 50, heading: hdg, flightId: 'f', onGround: true });
      world.addAI(lead, 'regular', { homeAerodromeId: home.id });
      world.addAI(wing, 'regular', { homeAerodromeId: home.id });
      let airborneAt = -1;
      runSim(world, 1600, {
        onStep: (t) => {
          if (airborneAt < 0 && lead.state.heightAboveGround > 30) airborneAt = t;
          return !!lead.outcome && !!wing.outcome;
        },
      });
      expect(airborneAt, `${id} lift-off`).toBeGreaterThan(0);
      expect(airborneAt, `${id} lift-off`).toBeLessThan(45);
      expect(lead.outcome, id).toBe('landed-friendly');
      expect(wing.outcome, id).toBe('landed-friendly');
      expect(Math.hypot(lead.state.position.x - home.x, lead.state.position.z - home.z), `${id} landed on the field`).toBeLessThan(1500);
    }
  });

  it('an ace beats a novice in most seeded duels without breaking his own airframe', () => {
    let wins = 0;
    let selfLosses = 0;
    const seeds = 6;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = combatRun({ a: 'se5a', sa: 'ace', b: 'albatros_dv', sb: 'novice', n: 1, seed });
      if (r.aLeft === 1 && r.bLeft === 0) wins++;
      selfLosses += r.selfStruct + r.selfCrashes;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
    expect(selfLosses).toBe(0);
  });

  it('regular furballs produce kills from gunfire, with short accurate bursts and no self-inflicted losses', () => {
    const matchups: [AircraftId, AircraftId, number][] = [
      ['se5a', 'albatros_dv', 2],
      ['sopwith_camel', 'fokker_dri', 2],
      ['spad_xiii', 'fokker_dvii', 4],
    ];
    for (const [a, b, n] of matchups) {
      let kills = 0;
      let collided = 0;
      let self = 0;
      let fired = 0;
      let hits = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const r = combatRun({ a, sa: 'regular', b, sb: 'regular', n, seed, seconds: 480 });
        kills += r.kills;
        self += r.selfStruct + r.selfCrashes;
        collided += r.outcomes.collided ?? 0;
        fired += r.firedA + r.firedB;
        hits += r.hitsA + r.hitsB;
      }
      expect(kills, `${a} v ${b} kills`).toBeGreaterThan(0);
      expect(self, `${a} v ${b} self-inflicted`).toBe(0);
      // Mid-air collisions happen in furballs (they did in 1917 too), but must stay rare.
      expect(collided, `${a} v ${b} collided`).toBeLessThanOrEqual(2);
      const pct = hits / Math.max(1, fired);
      expect(pct, `${a} v ${b} hit rate`).toBeGreaterThan(0.03);
      expect(pct, `${a} v ${b} hit rate`).toBeLessThan(0.3);
    }
  });

  it('a defending AI survives an ace far longer than a straight-flying target', () => {
    // Averaged over seeds: single duels swing from 30 s to 3 min either way.
    const survival = (defend: boolean, seed: number): number => {
      const world = new SimWorld({ frontX: 1e9, seed });
      const tgt = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 0, z: 0, alt: 1500, heading: 0, flightId: 't', skill: 'veteran' });
      const att = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 20, z: 450, alt: 1520, heading: 0, flightId: 'a', skill: 'ace' });
      world.addAI(att, 'ace', { seed: seed + 4 });
      if (defend) world.addAI(tgt, 'veteran', { seed: 6, task: 'recon' });
      let died = 240;
      runSim(world, 240, {
        scripted: defend ? undefined : new Map([[tgt.id, (ac: AircraftEntity) => void Object.assign(ac.controls, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 })]]),
        onStep: (t) => {
          if (tgt.outcome || tgt.damage.destroyed) {
            died = t;
            return true;
          }
        },
      });
      return died;
    };
    const seeds = [1, 2, 3, 4];
    const straight = seeds.reduce((t, s) => t + survival(false, s), 0) / seeds.length;
    const defended = seeds.reduce((t, s) => t + survival(true, s), 0) / seeds.length;
    expect(straight).toBeLessThan(60);
    expect(defended).toBeGreaterThan(straight * 2);
  });

  it("two-seater gunners punish a careless attacker sitting on their tail", () => {
    let gunnerHits = 0;
    let attackerLosses = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const wps: Waypoint[] = [{ x: 0, z: -30000, altitude: 1500, action: 'fly' }];
      const world = new SimWorld({ flights: [routeFlight('r', 'allied', 're8', wps, { task: 'recon' })], frontX: 1e9, seed });
      const re8 = world.addAircraft({ aircraftId: 're8', side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, flightId: 'r', skill: 'regular' });
      const att = world.addAircraft({ aircraftId: 'albatros_diii', side: 'central', x: 30, z: 500, alt: 1480, heading: 0, flightId: 'h', skill: 'novice' });
      world.addAI(re8, 'regular', { task: 'recon', seed });
      world.addAI(att, 'novice', { seed: seed + 10 });
      runSim(world, 120, { onStep: () => !!att.outcome || !!re8.outcome });
      gunnerHits += world.eventsOf('bullet-hit').filter((h) => h.shooterId === re8.id && h.targetId === att.id).length;
      // Punished: downed, wounded, or carrying real damage home (a lone gunner rarely kills).
      const dmg = Object.values(att.damage.zones).reduce((a, b) => a + b, 0);
      if (att.outcome || att.damage.pilotWounded || dmg >= 0.3) attackerLosses++;
    }
    expect(gunnerHits).toBeGreaterThan(8);
    expect(attackerLosses).toBeGreaterThanOrEqual(1);
  });

  it('balloon busters set the gasbag alight despite the archie, and some come home', () => {
    let burned = 0;
    let survived = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const world = new SimWorld({ frontX: 0, flak: true, seed });
      const balloon = world.addBalloon('central', 5000, -3000, 700);
      const wps: Waypoint[] = [
        { x: 4000, z: -2000, altitude: 900, action: 'attack-balloon', targetIds: ['b1'] },
        { x: -6000, z: 0, altitude: 1000, action: 'fly' },
      ];
      world.addFlight(routeFlight('bb', 'allied', 'se5a', wps, { task: 'balloon-attack' }));
      const ac = world.addAircraft({ aircraftId: 'se5a', side: 'allied', x: -3000, z: 0, alt: 1200, heading: Math.PI / 2, flightId: 'bb', skill: 'veteran' });
      world.addAI(ac, 'veteran', { task: 'balloon-attack', seed });
      runSim(world, 300, { onStep: () => !!ac.outcome || (balloon.destroyed && ac.state.position.x < -500) });
      if (balloon.destroyed || balloon.burning) burned++;
      if (!ac.outcome) survived++;
    }
    expect(burned).toBeGreaterThanOrEqual(3);
    expect(survived).toBeGreaterThanOrEqual(1);
  });

  it('turns for home when out of ammunition or badly damaged', () => {
    for (const setup of ['ammo', 'engine'] as const) {
      const world = new SimWorld({ frontX: 3000 });
      const ac = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 8000, z: 0, alt: 1500, heading: Math.PI / 2 });
      const enemy = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 8600, z: 0, alt: 1500, heading: Math.PI / 2, controller: 'none' });
      enemy.controls.throttle = 0.7;
      const ctl = world.addAI(ac, 'regular');
      if (setup === 'ammo') for (const g of ac.guns) (g.roundsLeft = 0), (g.sparesLeft = 0);
      else ac.damage.zones.engine = 0.6;
      runSim(world, 300, { onStep: () => world.sideOfFrontAt(ac.state.position.x, ac.state.position.z) === "allied" && ac.state.position.x < 1500 });
      expect(ctl.phase, setup).toBe('rtb');
      expect(ac.outcome, setup).toBeNull();
      expect(world.sideOfFrontAt(ac.state.position.x, ac.state.position.z), setup).toBe('allied');
    }
  });

  it('never flies into hilly terrain during a low-level dogfight', () => {
    const hills = (x: number, z: number) => 200 + 220 * Math.sin(x / 1300) * Math.cos(z / 1100) + 80 * Math.sin((x + z) / 500);
    const world = new SimWorld({ ground: hills, frontX: 1e9 });
    const skills: SkillLevel[] = ['novice', 'regular', 'veteran', 'ace'];
    const all: AircraftEntity[] = [];
    for (let i = 0; i < 4; i++) {
      all.push(world.addAircraft({ aircraftId: 'fokker_dri', side: 'central', x: i * 200, z: -900, alt: 750, heading: Math.PI, flightId: 'c', skill: skills[i] }));
      all.push(world.addAircraft({ aircraftId: 'spad_xiii', side: 'allied', x: i * 200, z: 900, alt: 700, heading: 0, flightId: 'a', skill: skills[3 - i] }));
    }
    all.forEach((a, i) => world.addAI(a, a.skill, { seed: i + 1 }));
    runSim(world, 180);
    const selfCrashes = all.filter((a) => (a.outcome === 'crashed' || a.outcome === 'ditched') && a.damage.lastAttackerId === null);
    expect(selfCrashes.map((a) => `${a.spec.id}/${a.skill}`)).toEqual([]);
  });
});
