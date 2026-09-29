/**
 * Autoplayer: fly a whole MissionDefinition headlessly (Node or browser) with
 * the real sim, combat, AI and mission director, the player's aircraft
 * flown by an AI controller. Used for mission/career QA (see docs/game.md
 * "Autoplayer") — it answers "does this mission actually play?" without a
 * renderer.
 */
import { Vector3 } from 'three';
import { createAIController, releaseAIPilot } from '../ai';
import { aiControllerOptions } from './aiOptions';
import type { AimTelemetry, GameEvent, MissionDefinition, MissionResult, RealismSettings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/settings';
import { bankAngle, createCombatSystem, createFlightEnvironment, createRng, pitchAngle, setGunnerTarget, sim } from '../sim';
import { sideOfFrontAt } from '../world/frontline';
import { terrainHeightAt } from '../world/terrain';
import { humanPilotFromEnv, type HumanPilotParams } from '../ai/humanAim';
import { AimTracker } from './aimStats';
import { LossCauseTracker } from './lossCause';
import { SIM_HZ, SimCore, type SimCoreModules } from './simCore';

/** The headless subset of GameModules, bound to the real implementations. */
export const headlessModules: SimCoreModules = {
  sim,
  createFlightEnvironment,
  createCombatSystem: (bus, getRealism) => createCombatSystem(bus, getRealism),
  createAIController: (ac, o) =>
    createAIController(ac, aiControllerOptions(ac, o, setGunnerTarget)),
  releaseAIPilot,
  setGunnerTarget,
  terrainHeightAt,
  sideOfFrontAt,
};

/**
 * `headlessModules` with the chance draws (gun dispersion, damage rolls, AI decisions) reseeded,
 * so one mission can be flown several different ways (the flight-report replay). Variant 0 is
 * `headlessModules` itself: the same seeds as the game.
 */
export function seededHeadlessModules(variant: number): SimCoreModules {
  if (!variant) return headlessModules;
  return {
    ...headlessModules,
    createCombatSystem: (bus, getRealism) => createCombatSystem(bus, getRealism, { rng: createRng(0xc0ffee + variant * 7717) }),
    // The controller's own default seed (controller.ts) offset per variant.
    createAIController: (ac, o) =>
      createAIController(ac, { ...aiControllerOptions(ac, o, setGunnerTarget), seed: ac.id * 7919 + 13 + variant * 104729 }),
  };
}

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
  /** Modules to fly with (default `headlessModules`; see `seededHeadlessModules`). */
  modules?: SimCoreModules;
  /**
   * Who flies the player's aircraft: the AI pilot (`'ai'`), or the same AI aiming and firing
   * like a human mouse-aim player (`'human'`: src/ai/humanAim.ts HUMAN_PILOT, or explicit
   * parameters). Default: `AUTOPLAY_PILOT` / `AUTOPLAY_HUMAN` from the environment, else `'ai'`.
   */
  pilot?: 'ai' | 'human' | HumanPilotParams;
}

/** The human-like pilot from the environment (AUTOPLAY_PILOT=human), when run under Node. */
export function envHumanPilot(): HumanPilotParams | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env ? humanPilotFromEnv(env) : undefined;
}

function resolvePilot(p: AutoplayOptions['pilot']): HumanPilotParams | undefined {
  if (p === undefined) return envHumanPilot();
  if (p === 'ai') return undefined;
  return p === 'human' ? humanPilotFromEnv({ AUTOPLAY_PILOT: 'human' }) : p;
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
  /** The player's gunnery (src/game/aimStats.ts): by mount, aim error with the trigger held. */
  aim: AimTelemetry;
  /** The player's aircraft aimed like a human (AutoplayOptions.pilot). */
  humanPilot: boolean;
}

export function runAutoplay(mission: MissionDefinition, opts: AutoplayOptions = {}): AutoplayReport {
  const realism = opts.realism ?? DEFAULT_SETTINGS.realism;
  const maxTime = opts.maxTime ?? 2400;
  const contactRange = opts.contactRange ?? 3000;
  const human = opts.passivePlayer ? undefined : resolvePilot(opts.pilot);
  const core = new SimCore(opts.modules ?? headlessModules, mission, () => realism, { aiPlayer: !opts.passivePlayer, humanPlayer: human });
  const { world, director, bus } = core;
  const player = world.player;

  const events: AutoplayReport['events'] = {};
  let firstPlayerShot: number | null = null;
  let playerKills = 0;
  let balloonsDestroyed = 0;
  let groundDestroyed = 0;
  const acesDowned = new Set<string>();
  const loss = new LossCauseTracker(world, player, () => (core.ai.get(player!.id) as { phase?: string } | undefined)?.phase ?? '?');
  const collisions: string[] = [];
  const aim = new AimTracker(world, player);
  bus.onAny((e) => {
    loss.onEvent(e);
    aim.onEvent(e);
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
    loss.step();
    aim.afterStep();
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
    playerLossCause: loss.cause,
    collisions,
    events,
    aim: aim.telemetry(),
    humanPilot: !!human,
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
