/**
 * Mid-air collision scenarios on the real sim (used by collision.soak.test.ts and
 * collision.realsim.test.ts): 4v4 head-on furballs, optionally with the allied leader
 * flown "like a human" (no collision avoidance of its own), and a 5-ship vic through turns.
 */
import { Vector3 } from 'three';
import type { AircraftEntity, AircraftId, MissionFlight } from '../../core/types';
import { runSim, SimWorld } from './realSimHarness';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Tally {
  runs: number;
  collisions: Map<string, number>;
  kills: number;
  firstKill: number[];
  humanLost: number;
}

function classify(world: SimWorld, a: AircraftEntity, b: AircraftEntity): string {
  const fa = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation);
  const fb = new Vector3(0, 0, -1).applyQuaternion(b.state.orientation);
  const ang = (Math.acos(Math.max(-1, Math.min(1, fa.dot(fb)))) * 180) / Math.PI;
  const geo = ang > 120 ? 'head-on' : ang > 45 ? 'crossing' : 'converging';
  const human = a.controller === 'player' || b.controller === 'player' ? 'human-' : '';
  const rel = a.side !== b.side ? 'enemy' : a.flightId === b.flightId ? 'wingman' : 'friendly';
  const wreck = a.damage.destroyed || b.damage.destroyed ? ' wreck' : '';
  const st = [a, b].map((x) => world.controllers.get(x.id)?.phase ?? '-').join('/');
  return `${human}${rel}${wreck} ${geo} ${st}`;
}

export function furball(seed: number, tally: Tally, humanLeader: boolean): void {
  const rng = mulberry(seed);
  const world = new SimWorld({ frontX: 1e9, seed, ground: () => 60 });
  const alliedTypes: AircraftId[] = ['sopwith_camel', 'se5a', 'sopwith_camel', 'spad_xiii'];
  const centralTypes: AircraftId[] = ['albatros_dv', 'fokker_dri', 'fokker_dvii', 'pfalz_diiia'];
  const A: AircraftEntity[] = [];
  const B: AircraftEntity[] = [];
  for (let i = 0; i < 4; i++) {
    const slot = i === 0 ? [0, 0] : [(i % 2 ? 1 : -1) * 60 * Math.ceil(i / 2), 50 * Math.ceil(i / 2)];
    A.push(world.addAircraft({ aircraftId: alliedTypes[i], side: 'allied', x: slot[0] + rng() * 20, z: 1300 + slot[1], alt: 1500 + rng() * 60, heading: 0, flightId: 'A', skill: 'regular', controller: humanLeader && i === 0 ? 'player' : 'ai' }));
    B.push(world.addAircraft({ aircraftId: centralTypes[i], side: 'central', x: slot[0] + (rng() - 0.5) * 200, z: -1300 - slot[1], alt: 1500 + rng() * 150, heading: Math.PI, flightId: 'B', skill: 'regular' }));
  }
  A.forEach((ac, i) => world.addAI(ac, i === 0 ? 'veteran' : 'regular', { seed: seed * 100 + ac.id, leaderId: i ? A[0].id : undefined, formationSlot: i || undefined, avoidCollisions: !(humanLeader && i === 0) }));
  B.forEach((ac, i) => world.addAI(ac, 'regular', { seed: seed * 100 + ac.id, leaderId: i ? B[0].id : undefined, formationSlot: i || undefined }));
  run(world, tally, 240, A, B);
}

export function vic(seed: number, tally: Tally): void {
  const rng = mulberry(seed);
  const wps = [
    { x: 3000, z: -3000, altitude: 1500, action: 'fly' as const },
    { x: 0, z: -6000, altitude: 1300, action: 'fly' as const },
    { x: -3000, z: -2500, altitude: 1700, action: 'fly' as const },
    { x: 0, z: 0, altitude: 1500, action: 'fly' as const },
  ];
  const f: MissionFlight = { id: 'V', role: 'friendly', side: 'allied', nation: 'britain', aircraftId: 'sopwith_camel', members: [], start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 45 }, waypoints: wps, task: 'fighter-sweep' };
  const world = new SimWorld({ frontX: 1e9, seed, ground: () => 60, flights: [f] });
  const V: AircraftEntity[] = [];
  const types: AircraftId[] = ['sopwith_camel', 'sopwith_camel', 'se5a', 'sopwith_camel', 'se5a'];
  for (let i = 0; i < 5; i++) V.push(world.addAircraft({ aircraftId: types[i], side: 'allied', x: (i % 2 ? 1 : -1) * 40 * Math.ceil(i / 2) + rng() * 10, z: 40 * Math.ceil(i / 2), alt: 1500 + rng() * 20, heading: 0, flightId: 'V', skill: 'regular' }));
  V.forEach((ac, i) => world.addAI(ac, 'regular', { seed: seed * 100 + ac.id, leaderId: i ? V[0].id : undefined, formationSlot: i || undefined }));
  run(world, tally, 300, V, []);
}

function run(world: SimWorld, tally: Tally, seconds: number, A: AircraftEntity[], B: AircraftEntity[]): void {
  const seen = new Set<string>();
  let first = -1;
  let kills = 0;
  let evs = 0;
  runSim(world, seconds, {
    onStep: () => {
      const cs = world.eventsOf('collision');
      for (let i = evs; i < cs.length; i++) {
        const a = world.getEntity(cs[i].aId);
        const b = world.getEntity(cs[i].bId);
        if (a?.kind !== 'aircraft' || b?.kind !== 'aircraft') continue;
        const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = classify(world, a, b);
        tally.collisions.set(c, (tally.collisions.get(c) ?? 0) + 1);
      }
      evs = cs.length;
      const k = world.eventsOf('aircraft-destroyed').filter((e) => e.killerId !== null).length;
      if (k > kills && first < 0) first = world.time;
      kills = k;
      return B.length > 0 && (A.every((x) => x.outcome) || B.every((x) => x.outcome));
    },
  });
  tally.runs++;
  tally.kills += kills;
  if (first >= 0) tally.firstKill.push(first);
  if (A[0]?.controller === 'player' && A[0].outcome && A[0].outcome !== 'landed-friendly') tally.humanLost++;
}


export const tally = (): Tally => ({ runs: 0, collisions: new Map(), kills: 0, firstKill: [], humanLost: 0 });
