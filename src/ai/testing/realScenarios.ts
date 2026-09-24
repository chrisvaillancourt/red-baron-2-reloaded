/**
 * Reusable real-sim scenarios (combat duels/furballs, routes) shared by the
 * CI scenario tests (*.realsim.test.ts) and the AI_SOAK tuning runs.
 */
import type { AircraftEntity, AircraftId, MissionFlight, SkillLevel, Waypoint } from '../../core/types';
import { getCoefficients } from '../../sim';
import { runSim, SimWorld } from './realSimHarness';

export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function routeFlight(id: string, side: 'allied' | 'central', aircraftId: AircraftId, waypoints: Waypoint[], extra: Partial<MissionFlight> = {}): MissionFlight {
  return {
    id,
    role: side === 'allied' ? 'friendly' : 'enemy',
    side,
    nation: side === 'allied' ? 'britain' : 'germany',
    aircraftId,
    members: [],
    start: { x: 0, z: 0, altitude: 1500, heading: 0, airspeed: 50 },
    waypoints,
    task: 'fighter-sweep',
    ...extra,
  };
}

export interface CombatRunResult {
  world: SimWorld;
  A: AircraftEntity[];
  B: AircraftEntity[];
  aLeft: number;
  bLeft: number;
  firstKill: number | null;
  endTime: number;
  kills: number;
  /** Rounds fired / hits by side A and B. */
  firedA: number;
  firedB: number;
  hitsA: number;
  hitsB: number;
  /** Structural failures not preceded by combat damage to that wing (self-inflicted). */
  selfStruct: number;
  struct: number;
  /** Crashes with no attacker credited (flew into the ground). */
  selfCrashes: number;
  collisions: number;
  /** Summed AI stats per side (s): guns solution, firing, defending; and first shot time. */
  statsA: { solution: number; firing: number; defend: number };
  statsB: { solution: number; firing: number; defend: number };
  firstShot: number | null;
  outcomes: Record<string, number>;
}

export interface CombatRunOpts {
  a: AircraftId;
  sa: SkillLevel;
  b: AircraftId;
  sb: SkillLevel;
  /** Aircraft per side (or [nA, nB]). */
  n: number | [number, number];
  seed: number;
  seconds?: number;
  alt?: number;
  /** Separation between the groups at start, m (head-on). */
  separation?: number;
  tap?: (w: SimWorld) => void;
}

/** Two groups start head-on and fight until one side is gone or time runs out. */
export function combatRun(o: CombatRunOpts): CombatRunResult {
  const [nA, nB] = Array.isArray(o.n) ? o.n : [o.n, o.n];
  const seconds = o.seconds ?? 600;
  const alt = o.alt ?? 1500;
  const sep = (o.separation ?? 3000) / 2;
  const world = new SimWorld({ frontX: 1e9, seed: o.seed });
  const A: AircraftEntity[] = [];
  const B: AircraftEntity[] = [];
  const rng = mulberry(o.seed);
  for (let i = 0; i < nA; i++)
    A.push(world.addAircraft({ aircraftId: o.a, side: 'allied', x: (i - nA / 2) * 70 + rng() * 150, z: sep + i * 40 + rng() * 300, alt: alt + i * 15 + rng() * 250, heading: 0, flightId: 'A', skill: o.sa }));
  for (let i = 0; i < nB; i++)
    B.push(world.addAircraft({ aircraftId: o.b, side: 'central', x: (i - nB / 2) * 70 + rng() * 150, z: -sep - i * 40 - rng() * 300, alt: alt + i * 15 + rng() * 250, heading: Math.PI, flightId: 'B', skill: o.sb }));
  for (const ac of A) world.addAI(ac, o.sa, { seed: o.seed * 100 + ac.id });
  for (const ac of B) world.addAI(ac, o.sb, { seed: o.seed * 100 + ac.id });
  let firstKill: number | null = null;
  let firstShotTime = 0;
  const combatWing = new Set<number>();
  runSim(world, seconds, {
    onStep: () => {
      o.tap?.(world);
      for (const ac of world.aircraft) if (ac.damage.zones.leftWing > 0 || ac.damage.zones.rightWing > 0 || ac.damage.zones.tail > 0) if (!ac.damage.structuralFailure) combatWing.add(ac.id);
      if (firstKill === null && world.eventsOf('aircraft-destroyed').length) firstKill = world.time;
      if (!firstShotTime && world.aircraft.some((x) => x.controls.fireGuns)) firstShotTime = world.time;
      return A.every((x) => x.outcome) || B.every((x) => x.outcome);
    },
  });
  const fired = world.eventsOf('gun-fired');
  const hits = world.eventsOf('bullet-hit').filter((h) => h.zone !== 'ground');
  const aIds = new Set(A.map((x) => x.id));
  const structEvents = world.eventsOf('structural-failure');
  const outcomes: Record<string, number> = {};
  for (const ac of world.aircraft) {
    const key = ac.outcome ?? `alive:${world.controllers.get(ac.id)?.phase ?? '?'}${world.controllers.get(ac.id)?.homeReason ? `(${world.controllers.get(ac.id)?.homeReason})` : ''}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  return {
    world,
    A,
    B,
    aLeft: A.filter((x) => !x.outcome).length,
    bLeft: B.filter((x) => !x.outcome).length,
    firstKill,
    endTime: world.time,
    kills: world.eventsOf('aircraft-destroyed').length,
    firedA: fired.filter((f) => aIds.has(f.shooterId)).length,
    firedB: fired.filter((f) => !aIds.has(f.shooterId)).length,
    hitsA: hits.filter((h) => aIds.has(h.shooterId)).length,
    hitsB: hits.filter((h) => !aIds.has(h.shooterId)).length,
    struct: structEvents.length,
    selfStruct: structEvents.filter((e) => !combatWing.has(e.aircraftId)).length,
    selfCrashes: world.aircraft.filter((x) => x.outcome === 'crashed' && x.damage.lastAttackerId === null).length,
    collisions: world.eventsOf('collision').length,
    statsA: sumStats(world, A),
    statsB: sumStats(world, B),
    firstShot: fired.length ? firstShotTime : null,
    outcomes,
  };
}

/** Rolling per-aircraft state history for diagnosis logs. */
export function historyTap(rows: string[], label: string): (w: SimWorld) => void {
  const hist = new Map<number, string[]>();
  const seen = new Set<number>();
  let step = 0;
  return (world) => {
    step++;
    for (const ac of world.aircraft) {
      if (seen.has(ac.id)) continue;
      const co = getCoefficients(ac.spec);
      const h = hist.get(ac.id) ?? [];
      const ctl = world.controllers.get(ac.id);
      if (step % 12 === 0)
        h.push(
          `  t=${world.time.toFixed(1)} V=${ac.state.airspeed.toFixed(0)}/${co.vne.toFixed(0)} g=${ac.state.gLoad.toFixed(1)}/${co.gLimit.toFixed(1)} vy=${ac.state.velocity.y.toFixed(0)} agl=${ac.state.heightAboveGround.toFixed(0)} aoa=${(ac.state.aoa * 57.3).toFixed(0)} st=${ac.state.stalled ? 1 : 0} ctl=${ac.controls.pitch.toFixed(2)},${ac.controls.roll.toFixed(2)},${ac.controls.yaw.toFixed(2)},${ac.controls.throttle.toFixed(2)} wd=${Math.max(ac.damage.zones.leftWing, ac.damage.zones.rightWing).toFixed(2)} ${ctl?.debugState}`,
        );
      if (h.length > Number(process.env.AI_HIST ?? 15) + 5) h.shift();
      hist.set(ac.id, h);
      const why = ac.damage.structuralFailure ? 'STRUCTURAL' : ac.outcome === 'crashed' && ac.damage.lastAttackerId === null ? 'CRASHED' : null;
      if (why) {
        seen.add(ac.id);
        rows.push(`--- ${label} ${ac.spec.id}#${ac.id} (${ac.skill}) ${why} attacker=${ac.damage.lastAttackerId}`, ...h.slice(-Number(process.env.AI_HIST ?? 15)));
      }
      if (ac.outcome) seen.add(ac.id);
    }
  };
}

function sumStats(world: SimWorld, list: AircraftEntity[]): { solution: number; firing: number; defend: number } {
  const out = { solution: 0, firing: 0, defend: 0 };
  for (const ac of list) {
    const st = world.controllers.get(ac.id)?.stats;
    if (!st) continue;
    out.solution += st.gunsSolutionTime;
    out.firing += st.firingTime;
    out.defend += st.defendTime;
  }
  return out;
}
