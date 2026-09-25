import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AIController } from '../core/interfaces';
import type { AircraftEntity, MissionFlight, SkillLevel, Waypoint } from '../core/types';
import { createAIController, type AIPilot } from './controller';
import { leadSolution } from './gunnery';
import { BULLET_DRAG_K } from '../sim/combat';
import { makeSkillProfile, skillValue } from './skill';
import type { ModelVariant } from './testing/pointMassModel';
import { makeAircraft, runScenario, TestWorld, TEST_REALISM } from './testing/testWorld';

function ai(ac: AircraftEntity, skill: SkillLevel, extra: Partial<Parameters<typeof createAIController>[1]> = {}): AIPilot {
  return createAIController(ac, { role: ac.side === 'allied' ? 'friendly' : 'enemy', task: 'fighter-sweep', skill, realism: TEST_REALISM, controlLaw: 'generic', ...extra });
}

const VARIANTS: [string, ModelVariant][] = [
  ['soft elevator', { pitchGain: 2.2 }],
  ['hot elevator + trim error', { pitchGain: 6.5, pitchTrim: 0.12 }],
  ['sluggish, laggy roll', { rollGain: 0.55, rollLag: 2.5 }],
  ['twitchy roll', { rollGain: 1.6, rollLag: 12 }],
];

describe('robustness to an unfamiliar flight model', () => {
  for (const [name, variant] of VARIANTS) {
    it(`${name}: waypoint route flown and a 2v2 fight survived without hitting the ground`, () => {
      const wps: Waypoint[] = [
        { x: 0, z: -6000, altitude: 1800, action: 'fly' },
        { x: 6000, z: -6000, altitude: 1200, action: 'fly' },
      ];
      const f: MissionFlight = {
        id: 'w', role: 'friendly', side: 'allied', nation: 'britain', aircraftId: 'se5a', members: [],
        start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 50 }, waypoints: wps, task: 'fighter-sweep',
      };
      const world = new TestWorld({ frontX: 50000, flights: [f], ground: (x, z) => 150 + 120 * Math.sin(x / 900) * Math.cos(z / 700) });
      const nav = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, flightId: 'w' });
      world.aircraft.push(nav);
      const fighters: AircraftEntity[] = [
        makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 20000, z: 1000, alt: 900, heading: 0, flightId: 'a' }),
        makeAircraft({ aircraftId: 'spad_xiii', side: 'allied', x: 20060, z: 1060, alt: 950, heading: 0, flightId: 'a' }),
        makeAircraft({ aircraftId: 'fokker_dri', side: 'central', x: 20000, z: -1000, alt: 1000, heading: Math.PI, flightId: 'c' }),
        makeAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 20060, z: -1060, alt: 900, heading: Math.PI, flightId: 'c' }),
      ];
      world.aircraft.push(...fighters);
      const skills: SkillLevel[] = ['ace', 'novice', 'veteran', 'regular'];
      const ctls = new Map<number, AIController>([[nav.id, ai(nav, 'regular')], ...fighters.map((a, i) => [a.id, ai(a, skills[i], { seed: 70 + i })] as [number, AIController])]);
      const minDist = wps.map(() => Infinity);
      runScenario(world, ctls, 240, {
        variant,
        onStep: () => wps.forEach((w, i) => (minDist[i] = Math.min(minDist[i], Math.hypot(w.x - nav.state.position.x, w.z - nav.state.position.z)))),
      });
      for (const d of minDist) expect(d).toBeLessThan(900);
      for (const a of world.aircraft) expect(a.outcome, `${a.spec.id} ${(ctls.get(a.id) as AIPilot).debugState}`).toBeNull();
    });
  }

  it('also works when updated at the full 120 Hz sim rate', () => {
    const world = new TestWorld({ frontX: 50000 });
    const a = makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: 800, alt: 1500, heading: 0, flightId: 'a' });
    const b = makeAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 150, z: -800, alt: 1500, heading: Math.PI, flightId: 'b' });
    world.aircraft.push(a, b);
    const ca = ai(a, 'ace', { seed: 3 });
    runScenario(world, new Map<number, AIController>([[a.id, ca], [b.id, ai(b, 'veteran', { seed: 4 })]]), 90, { aiEvery: 1 });
    expect(a.outcome).toBeNull();
    expect(b.outcome).toBeNull();
    expect(ca.stats.gunsSolutionTime).toBeGreaterThan(0);
  });
});

describe('ground attack', () => {
  it('makes strafing runs on an enemy battery and pulls out safely', () => {
    const wps: Waypoint[] = [{ x: 7000, z: 0, altitude: 800, action: 'attack-ground' }];
    const f: MissionFlight = {
      id: 'g', role: 'friendly', side: 'allied', nation: 'britain', aircraftId: 'sopwith_camel', members: [],
      start: { x: 0, z: 0, altitude: 800, heading: Math.PI / 2, airspeed: 45 }, waypoints: wps, task: 'ground-attack',
    };
    const world = new TestWorld({ frontX: 3000, flights: [f] });
    world.groundTargets.push({ id: 800, kind: 'ground', type: 'artillery', side: 'central', position: new Vector3(7200, 50, 150), heading: 0, health: 1, destroyed: false });
    const ac = makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: 0, alt: 800, heading: Math.PI / 2, flightId: 'g' });
    world.aircraft.push(ac);
    const ctl = ai(ac, 'veteran', { task: 'ground-attack' });
    let firing = 0;
    let minAgl = Infinity;
    runScenario(world, new Map([[ac.id, ctl]]), 200, {
      onStep: () => {
        if (ac.controls.fireGuns) firing++;
        if (ctl.phase === 'attack-ground') minAgl = Math.min(minAgl, ac.state.heightAboveGround);
      },
    });
    expect(ac.outcome).toBeNull();
    expect(firing / 120).toBeGreaterThan(1);
    expect(minAgl).toBeGreaterThan(15);
  });
});

describe('gunnery & skill', () => {
  it('lead solution hits a constant-velocity target (sim bullet drag and drop)', () => {
    const sp = new Vector3(0, 1000, 0);
    const sv = new Vector3(0, 0, -50);
    const tp = new Vector3(40, 1010, -250);
    const tv = new Vector3(30, 0, -40);
    const mv = 800;
    const sol = leadSolution(sp, sv, tp, tv, null, mv);
    // Integrate the round as src/sim/combat.ts does.
    const b = sp.clone();
    const bv = sv.clone().addScaledVector(sol.dir, mv);
    const dt = 1 / 600;
    let best = Infinity;
    for (let t = dt; t < 1.5; t += dt) {
      bv.multiplyScalar(1 - BULLET_DRAG_K * bv.length() * dt);
      bv.y -= 9.81 * dt;
      b.addScaledVector(bv, dt);
      best = Math.min(best, b.distanceTo(tp.clone().addScaledVector(tv, t)));
    }
    expect(best).toBeLessThan(0.5);
  });

  it('enemy skill bias shifts only enemy pilots', () => {
    const r = { ...TEST_REALISM, enemySkillBias: 1 };
    expect(skillValue('regular', 'enemy', r)).toBeGreaterThan(skillValue('regular', 'friendly', r));
    expect(makeSkillProfile(1).aimNoiseRad).toBeLessThan(makeSkillProfile(0).aimNoiseRad);
    expect(makeSkillProfile(1).reactionDelay).toBeLessThan(makeSkillProfile(0).reactionDelay);
  });
});
