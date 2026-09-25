/**
 * Autoplayer: fly a whole MissionDefinition headlessly (Node or browser) with
 * the real sim, combat, AI and mission director, the player's aircraft
 * flown by an AI controller. Used for mission/career QA (see docs/game.md
 * "Autoplayer") — it answers "does this mission actually play?" without a
 * renderer.
 */
import { Vector3 } from 'three';
import { createAIController } from '../ai';
import { aiControllerOptions } from './aiOptions';
import type { GameEvent, MissionDefinition, MissionResult, RealismSettings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/settings';
import { bankAngle, createCombatSystem, createFlightEnvironment, pitchAngle, setGunnerTarget, sim } from '../sim';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import { SIM_HZ, SimCore, type SimCoreModules } from './simCore';

/** The headless subset of GameModules, bound to the real implementations. */
export const headlessModules: SimCoreModules = {
  sim,
  createFlightEnvironment,
  createCombatSystem: (bus, getRealism) => createCombatSystem(bus, getRealism),
  createAIController: (ac, o) =>
    createAIController(ac, aiControllerOptions(ac, o, setGunnerTarget)),
  terrainHeightAt,
  sideOfFrontAt,
};

export interface AutoplayOptions {
  realism?: RealismSettings;
  /** Hard cap on simulated seconds (default 40 min). */
  maxTime?: number;
  /** Distance (m) at which enemy aircraft count as "in contact" (default 3 km). */
  contactRange?: number;
  /** End the flight (N) once the player AI is heading home and it is safe (default true). */
  endFlightWhenSafe?: boolean;
  /**
   * A passive player instead of the AI: holds wings level and the nose on the horizon at 85%
   * throttle and never fights (the "does a newcomer survive the first minute?" check).
   */
  passivePlayer?: boolean;
}

export interface AutoplayReport {
  result: MissionResult;
  /** Simulated seconds flown. */
  time: number;
  timedOut: boolean;
  /** The flight was ended with "end flight" while safe (vs landing/crash/timeout). */
  endedFlight: boolean;
  /** First time an enemy aircraft came within contactRange of the player (null: never). */
  firstContact: number | null;
  /** Nearest enemy aircraft to the player at the start (m; Infinity if none). */
  initialEnemyRange: number;
  /** Distance from player start to the first objective location (balloon/ground/enemy start), m. */
  objectiveRange: number | null;
  firstPlayerShot: number | null;
  playerKills: number;
  enemyLosses: number;
  friendlyLosses: number;
  balloonsDestroyed: number;
  groundDestroyed: number;
  /** Aircraft that spawned below 30 m AGL while not starting on the ground. */
  badSpawns: string[];
  /** Balloons / ground targets on the wrong side of the front. */
  misplaced: string[];
  /** Ace ids of aircraft present / shot down. */
  acesPresent: string[];
  acesDowned: string[];
  /**
   * What took the player out (null: survived intact): `collision-<with>`,
   * `enemy-fire(<outcome>)`, `flak/ground(<outcome>)` or `self(<outcome>, <ai phase>)`.
   */
  playerLossCause: string | null;
  /**
   * Every aircraft-aircraft collision: `<pair> <geometry> <stateA>/<stateB>`, where pair is
   * player-enemy / player-wingman / player-friendly / ai-enemy / ai-wingman / ai-friendly,
   * `wreck` marks a pair where one was already going down, and geometry is the angle
   * between the two noses (head-on ~180, same heading ~0).
   */
  collisions: string[];
  events: Partial<Record<GameEvent['type'], number>>;
}

export function runAutoplay(mission: MissionDefinition, opts: AutoplayOptions = {}): AutoplayReport {
  const realism = opts.realism ?? DEFAULT_SETTINGS.realism;
  const maxTime = opts.maxTime ?? 2400;
  const contactRange = opts.contactRange ?? 3000;
  const core = new SimCore(headlessModules, mission, () => realism, { aiPlayer: !opts.passivePlayer });
  const { world, director, bus } = core;
  const player = world.player;

  const events: AutoplayReport['events'] = {};
  let firstPlayerShot: number | null = null;
  let playerKills = 0;
  let balloonsDestroyed = 0;
  let groundDestroyed = 0;
  const acesDowned = new Set<string>();
  let lastBulletHit = -Infinity;
  let lastSplinter = -Infinity;
  let collisionWith: string | null = null;
  let playerLossCause: string | null = null;
  let lastDamageSum = 0;
  let wasFailed = false;
  const collisions: string[] = [];
  bus.onAny((e) => {
    if (e.type === 'collision') {
      const a = world.getEntity(e.aId);
      const b = world.getEntity(e.bId);
      if (a?.kind === 'aircraft' && b?.kind === 'aircraft') {
        const withPlayer = a.id === player?.id || b.id === player?.id;
        const rel = a.side !== b.side ? 'enemy' : a.flightId === b.flightId ? 'wingman' : 'friendly';
        const fa = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation);
        const fb = new Vector3(0, 0, -1).applyQuaternion(b.state.orientation);
        const ang = Math.round((Math.acos(Math.max(-1, Math.min(1, fa.dot(fb)))) * 180) / Math.PI);
        const st = (x: typeof a) => (x.id === player?.id ? 'P:' : '') + ((core.ai.get(x.id) as { debugState?: string } | undefined)?.debugState ?? '-').replace(/ /g, '_');
        const wreck = a.damage.destroyed || b.damage.destroyed ? ' wreck' : '';
        collisions.push(`${withPlayer ? 'player' : 'ai'}-${rel}${wreck} ${ang}deg ${st(a)}/${st(b)} t=${world.time.toFixed(0)}`);
      }
    }
    if (player && e.type === 'bullet-hit' && e.targetId === player.id) lastBulletHit = world.time;
    if (player && e.type === 'collision' && (e.aId === player.id || e.bId === player.id) && collisionWith === null) {
      const other = world.getEntity(e.aId === player.id ? e.bId : e.aId);
      collisionWith = !other
        ? 'unknown'
        : other.kind !== 'aircraft'
          ? other.kind
          : other.side !== player.side
            ? 'enemy'
            : other.flightId === player.flightId
              ? 'wingman'
              : 'friendly';
    }
    events[e.type] = (events[e.type] ?? 0) + 1;
    if (e.type === 'gun-fired' && player && e.shooterId === player.id && firstPlayerShot === null) firstPlayerShot = world.time;
    if (e.type === 'aircraft-destroyed') {
      const v = world.getEntity(e.victimId);
      if (v?.kind === 'aircraft' && v.aceId) acesDowned.add(v.aceId);
      const credit = e.killerId ?? (v?.kind === 'aircraft' ? v.damage.lastAttackerId : null);
      if (player && credit === player.id && e.victimId !== player.id) playerKills++;
    }
    if (e.type === 'balloon-destroyed') balloonsDestroyed++;
    if (e.type === 'ground-destroyed') groundDestroyed++;
  });

  // Start-state sanity.
  const badSpawns: string[] = [];
  for (const f of mission.flights) {
    if (f.startOnGround) continue;
    const agl = f.start.altitude - terrainHeightAt(f.start.x, f.start.z);
    if (agl < 30) badSpawns.push(`${f.id} ${f.aircraftId} ${agl.toFixed(0)} m AGL`);
  }
  const misplaced: string[] = [];
  for (const b of mission.balloons) if (sideOfFrontAt(b.x, b.z, mission.date) !== b.side) misplaced.push(`balloon ${b.id}`);
  for (const g of mission.groundTargets) if (sideOfFrontAt(g.x, g.z, mission.date) !== g.side) misplaced.push(`ground ${g.id} ${g.type}`);
  const initialEnemyRange = player ? nearestEnemy(core, player.state.position) : Infinity;
  const objectiveRange = player ? objectiveDistance(mission, player.state.position) : null;
  const acesPresent = world
    .allAircraft()
    .map((a) => a.aceId)
    .filter((x): x is string => !!x);

  let firstContact: number | null = null;
  const h = 1 / SIM_HZ;
  let timedOut = false;
  let endedFlight = false;
  let stepN = 0;
  while (!director.ended) {
    if (opts.passivePlayer && player && player.outcome === null) {
      const c = player.controls;
      const s = player.state;
      c.throttle = 0.85;
      c.roll = Math.max(-1, Math.min(1, -bankAngle(s.orientation) * 2 + s.angularVelocity.z * 0.3));
      c.pitch = Math.max(-1, Math.min(1, -pitchAngle(s.orientation) * 3 + 0.05));
      c.yaw = 0;
      c.fireGuns = false;
    }
    core.step(h);
    if (player && playerLossCause === null) {
      // Damage that arrives without a bullet hit is flak or ground fire.
      let sum = 0;
      for (const v of Object.values(player.damage.zones)) sum += v;
      // A shot-up airframe that later fails (a zone jumps to 1) is the enemy's doing, not flak.
      const failedNow = player.damage.structuralFailure && !wasFailed;
      wasFailed = player.damage.structuralFailure;
      if (sum > lastDamageSum + 1e-9 && lastBulletHit < world.time - 0.02 && !failedNow) lastSplinter = world.time;
      lastDamageSum = sum;
      const o = player.outcome;
      if (o !== null && o !== 'landed-friendly' && o !== 'disengaged') {
        const phase = (core.ai.get(player.id) as { phase?: string } | undefined)?.phase ?? '?';
        const recent = (t: number) => world.time - t < 25;
        playerLossCause =
          o === 'collided'
            ? `collision-${collisionWith ?? '?'}`
            : recent(lastBulletHit) && (!recent(lastSplinter) || lastBulletHit >= lastSplinter)
              ? `enemy-fire(${o})`
              : recent(lastSplinter)
                ? `flak/ground(${o})`
                : `self(${o}, ${phase})`;
      }
    }
    if (player && player.outcome === null && ++stepN % 30 === 0) {
      if (firstContact === null && nearestEnemy(core, player.state.position) < contactRange) firstContact = world.time;
      // Like a human player: once heading home with the job done, end the flight when it's safe.
      const phase = (core.ai.get(player.id) as { phase?: string } | undefined)?.phase;
      if (opts.endFlightWhenSafe !== false && (phase === 'rtb' || phase === 'landing') && director.canEndFlight().ok) {
        endedFlight = director.requestEndFlight();
      }
    }
    if (world.time >= maxTime) {
      timedOut = true;
      if (!director.requestEndFlight()) director.abort();
    }
  }
  const result = director.buildResult();
  core.dispose();
  return {
    result,
    time: world.time,
    timedOut,
    endedFlight,
    firstContact,
    initialEnemyRange,
    objectiveRange,
    firstPlayerShot,
    playerKills,
    enemyLosses: result.enemyLosses,
    friendlyLosses: result.friendlyLosses.length,
    balloonsDestroyed,
    groundDestroyed,
    badSpawns,
    misplaced,
    acesPresent: [...new Set(acesPresent)],
    acesDowned: [...acesDowned],
    playerLossCause,
    collisions,
    events,
  };
}

function nearestEnemy(core: SimCore, pos: Vector3): number {
  const p = core.world.player;
  let best = Infinity;
  for (const a of core.world.aircraft) {
    if (!p || a.side === p.side || a.outcome !== null) continue;
    best = Math.min(best, a.state.position.distanceTo(pos));
  }
  return best;
}

function objectiveDistance(m: MissionDefinition, pos: Vector3): number | null {
  const pts: { x: number; z: number }[] = [
    ...m.balloons.filter((b) => m.objectives.some((o) => o.targetIds.includes(b.id))),
    ...m.groundTargets.filter((g) => m.objectives.some((o) => o.targetIds.includes(g.id))),
    ...m.flights.filter((f) => f.role !== 'player-flight' && m.objectives.some((o) => o.targetIds.includes(f.id))).map((f) => f.start),
  ];
  if (!pts.length) return null;
  return Math.min(...pts.map((p) => Math.hypot(p.x - pos.x, p.z - pos.z)));
}
