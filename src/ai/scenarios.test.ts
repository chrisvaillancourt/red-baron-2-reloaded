import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AIController } from '../core/interfaces';
import type { AircraftEntity, AircraftId, MissionFlight, SkillLevel, Waypoint } from '../core/types';
import { createAIController, type AIPilot } from './controller';
import { slotPosition, formationOffset } from './navigation';
import { angleBetween, forwardOf } from './math';
import { makeAircraft, runScenario, TestWorld, TEST_REALISM } from './testing/testWorld';

function flight(id: string, side: 'allied' | 'central', waypoints: Waypoint[], task: MissionFlight['task'] = 'fighter-sweep', extra: Partial<MissionFlight> = {}): MissionFlight {
  return {
    id,
    role: side === 'allied' ? 'friendly' : 'enemy',
    side,
    nation: side === 'allied' ? 'britain' : 'germany',
    aircraftId: side === 'allied' ? 'se5a' : 'albatros_dv',
    members: [],
    start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 50 },
    waypoints,
    task,
    ...extra,
  };
}

function ai(ac: AircraftEntity, skill: SkillLevel, extra: Partial<Parameters<typeof createAIController>[1]> = {}): AIPilot {
  return createAIController(ac, { role: ac.side === 'allied' ? 'friendly' : 'enemy', task: 'fighter-sweep', skill, realism: TEST_REALISM, controlLaw: 'generic', ...extra });
}

describe('AI scenarios (point-mass physics)', () => {
  it('leader flies its waypoints in order', () => {
    const wps: Waypoint[] = [
      { x: 0, z: -6000, altitude: 1800, action: 'fly' },
      { x: 5000, z: -9000, altitude: 1500, action: 'fly' },
      { x: 8000, z: -3000, altitude: 1200, action: 'fly' },
    ];
    const world = new TestWorld({ flights: [flight('a', 'allied', wps)], frontX: 50000 });
    const ac = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, flightId: 'a' });
    world.aircraft.push(ac);
    const ctl = ai(ac, 'regular');
    const minDist = wps.map(() => Infinity);
    runScenario(world, new Map([[ac.id, ctl]]), 400, {
      onStep: () => {
        wps.forEach((w, i) => (minDist[i] = Math.min(minDist[i], Math.hypot(w.x - ac.state.position.x, w.z - ac.state.position.z))));
      },
    });
    expect(ac.outcome).toBeNull();
    for (const d of minDist) expect(d).toBeLessThan(800);
  });

  it('wingmen hold a vic formation through turns within ~30 m', () => {
    const wps: Waypoint[] = [
      { x: 0, z: -5000, altitude: 1500, action: 'fly' },
      { x: 5000, z: -8000, altitude: 1600, action: 'fly' },
      { x: 9000, z: -2000, altitude: 1500, action: 'fly' },
      { x: 3000, z: 3000, altitude: 1500, action: 'fly' },
    ];
    const world = new TestWorld({ flights: [flight('a', 'allied', wps)], frontX: 50000 });
    const lead = makeAircraft({ id: 100, side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, flightId: 'a' });
    const w1 = makeAircraft({ id: 101, side: 'allied', x: 60, z: 60, alt: 1500, heading: 0, flightId: 'a' });
    const w2 = makeAircraft({ id: 102, side: 'allied', x: -80, z: 90, alt: 1500, heading: 0, flightId: 'a' });
    world.aircraft.push(lead, w1, w2);
    const ctls = new Map<number, AIController>([
      [lead.id, ai(lead, 'veteran')],
      [w1.id, ai(w1, 'regular', { leaderId: lead.id, formationSlot: 1 })],
      [w2.id, ai(w2, 'regular', { leaderId: lead.id, formationSlot: 2 })],
    ]);
    const errs: number[] = [];
    runScenario(world, ctls, 300, {
      onStep: (t) => {
        if (t < 40 || Math.round(t * 120) % 60 !== 0) return;
        for (const [w, slot] of [[w1, 1], [w2, 2]] as const) errs.push(slotPosition(lead, formationOffset(slot)).distanceTo(w.state.position));
      },
    });
    for (const a of world.aircraft) expect(a.outcome).toBeNull();
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const sorted = [...errs].sort((a, b) => a - b);
    expect(mean).toBeLessThan(30);
    expect(sorted[Math.floor(sorted.length * 0.9)]).toBeLessThan(70);
  });

  it('an ace gets a guns solution far more often than a novice (1v1, same type)', () => {
    let aceTime = 0;
    let novTime = 0;
    for (let seed = 0; seed < 3; seed++) {
      const world = new TestWorld({ frontX: 50000 });
      const type: AircraftId = 'sopwith_camel';
      const a = makeAircraft({ aircraftId: type, side: 'allied', x: 0, z: 800, alt: 1500, heading: 0, flightId: 'a', skill: 'ace' });
      const n = makeAircraft({ aircraftId: type, side: 'central', x: 150, z: -800, alt: 1500, heading: Math.PI, flightId: 'n', skill: 'novice' });
      world.aircraft.push(a, n);
      const ca = ai(a, 'ace', { seed: seed * 11 + 1 });
      const cn = ai(n, 'novice', { seed: seed * 11 + 2 });
      runScenario(world, new Map<number, AIController>([[a.id, ca], [n.id, cn]]), 120);
      aceTime += ca.stats.gunsSolutionTime;
      novTime += cn.stats.gunsSolutionTime;
      expect(a.outcome).toBeNull();
      expect(n.outcome).toBeNull();
    }
    expect(aceTime).toBeGreaterThan(3);
    expect(aceTime).toBeGreaterThan(novTime * 2);
  });

  it('never flies into hilly terrain during a low-level dogfight', () => {
    const hills = (x: number, z: number) => 200 + 220 * Math.sin(x / 1300) * Math.cos(z / 1100) + 80 * Math.sin((x + z) / 500);
    const world = new TestWorld({ ground: hills, frontX: 50000 });
    const pairs: AircraftEntity[] = [];
    const skills: SkillLevel[] = ['novice', 'regular', 'veteran', 'ace'];
    for (let i = 0; i < 4; i++) {
      pairs.push(makeAircraft({ aircraftId: 'fokker_dri', side: 'central', x: i * 200, z: -900, alt: 750, heading: Math.PI, flightId: 'c', skill: skills[i] }));
      pairs.push(makeAircraft({ aircraftId: 'spad_xiii', side: 'allied', x: i * 200, z: 900, alt: 700, heading: 0, flightId: 'a', skill: skills[3 - i] }));
    }
    world.aircraft.push(...pairs);
    const ctls = new Map<number, AIController>(pairs.map((p, i) => [p.id, ai(p, p.skill, { seed: i + 1 })]));
    runScenario(world, ctls, 150);
    for (const p of pairs) expect(p.outcome, `${p.spec.id} ${p.skill} ${(ctls.get(p.id) as AIPilot).debugState}`).toBeNull();
  });

  it('a damaged aircraft deep over enemy lines returns to the friendly side', () => {
    const world = new TestWorld({ frontX: 0, date: '1917-09-01' });
    const ac = makeAircraft({ side: 'allied', x: 9000, z: 0, alt: 1500, heading: Math.PI / 2, flightId: 'a' });
    ac.damage.zones.engine = 0.6;
    world.aircraft.push(ac);
    const ctl = ai(ac, 'regular');
    runScenario(world, new Map([[ac.id, ctl]]), 240);
    expect(ctl.phase === 'rtb' || ctl.phase === 'landing' || ctl.phase === 'landed').toBe(true);
    expect(world.sideOfFrontAt(ac.state.position.x, ac.state.position.z)).toBe('allied');
    expect(ac.outcome).toBeNull();
  });

  // Landing (approach, pattern, flare, rollout) depends on the real ground model and is
  // tested on src/sim in realsim.test.ts.

  it('balloon attack: dives on and flames an enemy balloon, then survives the pull-out', () => {
    const wps: Waypoint[] = [{ x: 6000, z: -3000, altitude: 1200, action: 'attack-balloon' }];
    const world = new TestWorld({ frontX: 3000, flights: [flight('a', 'allied', wps, 'balloon-attack')] });
    world.balloons.push({ id: 900, kind: 'balloon', side: 'central', position: new Vector3(6200, 50 + 800, -3100), anchor: new Vector3(6200, 50, -3100), health: 1, burning: false, destroyed: false, observerBailed: false });
    const ac = makeAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: 0, alt: 1200, heading: Math.PI / 2, flightId: 'a' });
    world.aircraft.push(ac);
    const ctl = ai(ac, 'veteran', { task: 'balloon-attack' });
    const b = world.balloons[0];
    runScenario(world, new Map([[ac.id, ctl]]), 300, {
      onStep: () => {
        if (!ac.controls.fireGuns || b.burning) return;
        const f = forwardOf(ac.state.orientation);
        const rel = b.position.clone().sub(ac.state.position);
        if (rel.length() < 400 && angleBetween(f, rel) < Math.atan2(10, rel.length()) + 0.02) {
          b.health -= 0.004;
          if (b.health <= 0) b.burning = true;
        }
        return false;
      },
    });
    expect(b.burning).toBe(true);
    expect(ac.outcome).toBeNull();
  });

  it('two-seater picks a rear-gunner target through the injected hook', () => {
    const world = new TestWorld({ frontX: 50000, flights: [flight('r', 'central', [{ x: 0, z: -20000, altitude: 2000, action: 'fly' }], 'recon')] });
    const r = makeAircraft({ aircraftId: 'rumpler_civ', side: 'central', x: 0, z: 0, alt: 2000, heading: 0, flightId: 'r' });
    const f = makeAircraft({ aircraftId: 'se5a', side: 'allied', x: 0, z: 350, alt: 2000, heading: 0, flightId: 'a', speed: 60 });
    world.aircraft.push(r, f);
    const calls: (number | null)[] = [];
    const ctl = createAIController(r, { role: 'enemy', task: 'recon', skill: 'regular', realism: TEST_REALISM, controlLaw: 'generic', setGunnerTarget: (_ac, id) => calls.push(id) });
    runScenario(world, new Map([[r.id, ctl]]), 3);
    expect(calls).toContain(f.id);
  });

  it('obeys wingman orders', () => {
    const world = new TestWorld({ frontX: 50000, flights: [flight('a', 'allied', [])] });
    const lead = makeAircraft({ id: 300, side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, flightId: 'a', controller: 'player' });
    const w = makeAircraft({ id: 301, side: 'allied', x: 50, z: 50, alt: 1500, heading: 0, flightId: 'a' });
    const e = makeAircraft({ id: 302, side: 'central', x: 0, z: -2500, alt: 1500, heading: Math.PI, flightId: 'e' });
    world.aircraft.push(lead, w, e);
    const ctl = ai(w, 'regular', { leaderId: lead.id, formationSlot: 1 });
    ctl.command('form-up');
    runScenario(world, new Map([[w.id, ctl]]), 2);
    expect(ctl.phase).toBe('formation');
    ctl.command('attack-my-target', e.id);
    runScenario(world, new Map([[w.id, ctl]]), 4);
    expect(ctl.targetId).toBe(e.id);
    expect(ctl.phase === 'engage' || ctl.phase === 'defend' || ctl.phase === 'extend').toBe(true);
    ctl.command('return-home');
    runScenario(world, new Map([[w.id, ctl]]), 6);
    expect(['rtb', 'defend', 'landing']).toContain(ctl.phase);
  });
});
