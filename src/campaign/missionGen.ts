/**
 * Career mission generator. Deterministic for a given pilot state: the RNG
 * is seeded from the pilot's seed, mission count and date.
 *
 * Objective targetId conventions (documented in docs/campaign.md):
 *   destroy-aircraft / protect-flight -> MissionFlight ids
 *   destroy-balloons / protect-balloons -> MissionBalloon ids
 *   destroy-ground -> MissionGroundTarget ids
 *   reach-waypoint -> "<flightId>:<waypointIndex>"
 *   patrol-area -> ["<flightId>:<wpA>", "<flightId>:<wpB>"], count = seconds on station
 */
import type { CareerDifficulty, CareerPilot, SquadronInfo } from '../core/campaignTypes';
import type {
  AircraftId,
  FlightRole,
  GroundTargetType,
  Livery,
  MissionBalloon,
  MissionDefinition,
  MissionFlight,
  MissionFlightMember,
  MissionGroundTarget,
  MissionObjective,
  MissionType,
  Nation,
  Side,
  SkillLevel,
  Waypoint,
} from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { aerodromesActiveOn, type AerodromeWorld } from '../data/aerodromes';
import { ACES, aceNamesOn, aceServiceOn, type Ace } from '../data/aces';
import { eventOn, type HistoricalEvent } from '../data/history';
import { composeLivery } from '../data/liveries';
import { getRank } from '../data/ranks';
import { getSquadronInfo } from '../data/squadrons';
import { terrainHeightAt } from '../world/terrain';
import { sideOfFrontAt } from '../world/frontline';
import { formatLongDate, yearOf } from './dates';
import { squadronRoster } from './names';
import {
  add,
  clampToSector,
  describeLocation,
  dist,
  enemyDirection,
  frontAnchor,
  heading,
  pointOnSide,
  type FrontPoint,
  type XZ,
} from './placement';
import { Rng, seedFrom } from './rng';
import { aircraftPool, nationForAircraft, squadronAircraftOn, squadronBaseOn, squadronsOfSide } from './squadronUtil';
import { describeWeather, fmt, randomTimeOfDay, seasonalWeather } from './weather';

export interface GenerateOptions {
  /** Begin parked on the home aerodrome instead of airborne near the lines. */
  startOnGround?: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface GenCtx {
  rng: Rng;
  date: string;
  side: Side;
  enemySide: Side;
  nation: Nation;
  difficulty: CareerDifficulty;
  event?: HistoricalEvent;
  imperial: boolean;
  /** Aces no longer available (killed/captured in this career). */
  unavailableAces: Set<string>;
  flights: MissionFlight[];
  balloons: MissionBalloon[];
  groundTargets: MissionGroundTarget[];
  objectives: MissionObjective[];
  counters: { flight: number; balloon: number; ground: number; objective: number };
  /** Player flight size (player + wingmen), rolled before planning so enemy numbers can scale to it. */
  playerFlightSize: number;
  /** Player's aircraft type, for arrival-time planning. */
  playerAircraft?: AircraftId;
  /** Enemy units and aces the briefing may mention. */
  intel: { squadrons: SquadronInfo[]; aces: Ace[] };
}

export function newCtx(seed: number, date: string, side: Side, nation: Nation, difficulty: CareerDifficulty, unavailableAces: Iterable<string> = []): GenCtx {
  return {
    rng: new Rng(seed),
    date,
    side,
    enemySide: side === 'allied' ? 'central' : 'allied',
    nation,
    difficulty,
    event: eventOn(date),
    imperial: nation === 'britain' || nation === 'usa',
    unavailableAces: new Set(unavailableAces),
    flights: [],
    balloons: [],
    groundTargets: [],
    objectives: [],
    counters: { flight: 0, balloon: 0, ground: 0, objective: 0 },
    playerFlightSize: 1,
    intel: { squadrons: [], aces: [] },
  };
}

/** Time on station that satisfies a patrol (the flight's two patrol legs orbit 2 x 120 s). */
export const PATROL_STATION_S = 150;
/** Air-start distance behind the lines for career missions (~1 min of flying). */
export const START_BEHIND_LINES_M = 3500;

const ENEMY_SKILL: Record<CareerDifficulty, readonly (readonly [SkillLevel, number])[]> = {
  recruit: [['novice', 6], ['regular', 3.5], ['veteran', 0.5]],
  pilot: [['novice', 3], ['regular', 5], ['veteran', 2], ['ace', 0.2]],
  ace: [['novice', 1.5], ['regular', 4], ['veteran', 3.5], ['ace', 1]],
};

export function cruiseSpeed(id: AircraftId): number {
  return (AIRCRAFT[id].performance.maxSpeedKmh / 3.6) * 0.8;
}

/** Typical patrol altitude (m ASL) by year, capped under the aircraft's ceiling. */
export function patrolAltitude(ctx: GenCtx, id: AircraftId): number {
  const y = yearOf(ctx.date);
  const [lo, hi] = y <= 1915 ? [1500, 2500] : y === 1916 ? [2000, 3200] : y === 1917 ? [2500, 4200] : [3000, 5000];
  const alt = Math.min(ctx.rng.range(lo, hi), AIRCRAFT[id].performance.ceilingM * 0.8);
  return Math.round(alt / 100) * 100;
}

export function fmtAlt(ctx: GenCtx, m: number): string {
  return ctx.imperial ? `${fmt(Math.round((m * 3.281) / 500) * 500)} feet` : `${fmt(Math.round(m / 100) * 100)} metres`;
}

function nextId(ctx: GenCtx, kind: 'flight' | 'balloon' | 'ground' | 'objective', prefix: string): string {
  ctx.counters[kind] += 1;
  return `${prefix}-${ctx.counters[kind]}`;
}

function wp(p: XZ, altitude: number, action: Waypoint['action'], extra: Partial<Waypoint> = {}): Waypoint {
  return { x: Math.round(p.x), z: Math.round(p.z), altitude: Math.round(altitude), action, ...extra };
}

function markingFor(nation: Nation, i: number): string {
  return nation === 'britain' || nation === 'usa' ? String.fromCharCode(65 + (i % 26)) : String(i + 1);
}

function aceAircraft(ace: Ace, date: string, allowed: AircraftId[]): AircraftId | undefined {
  const svc = aceServiceOn(ace, date);
  return svc?.aircraft.find((a) => allowed.includes(a));
}

export function acesWith(ctx: GenCtx, squadronId: string): Ace[] {
  return ACES.filter((a) => !ctx.unavailableAces.has(a.id) && aceServiceOn(a, ctx.date)?.squadronId === squadronId);
}

// ---------------------------------------------------------------------------
// Flight builders
// ---------------------------------------------------------------------------

export interface FlightSpec {
  role: FlightRole;
  side: Side;
  nation: Nation;
  aircraftId: AircraftId;
  squadronId?: string;
  members: MissionFlightMember[];
  start: XZ;
  altitude: number;
  waypoints: Waypoint[];
  task: MissionFlight['task'];
  spawnDelay?: number;
  escortFlightId?: string;
  startOnGround?: boolean;
  startHeading?: number;
  idPrefix: string;
}

export function addFlight(ctx: GenCtx, f: FlightSpec): MissionFlight {
  const first = f.waypoints[0] ?? f.start;
  const flight: MissionFlight = {
    id: nextId(ctx, 'flight', f.idPrefix),
    role: f.role,
    side: f.side,
    nation: f.nation,
    aircraftId: f.aircraftId,
    squadronId: f.squadronId,
    members: f.members,
    start: {
      x: Math.round(f.start.x),
      z: Math.round(f.start.z),
      altitude: Math.round(f.altitude),
      heading: f.startHeading ?? heading(f.start, first),
      airspeed: f.startOnGround ? 0 : Math.round(cruiseSpeed(f.aircraftId)),
    },
    startOnGround: f.startOnGround || undefined,
    waypoints: f.waypoints,
    spawnDelay: f.spawnDelay,
    task: f.task,
    escortFlightId: f.escortFlightId,
  };
  if (flight.spawnDelay === undefined) delete flight.spawnDelay;
  if (flight.escortFlightId === undefined) delete flight.escortFlightId;
  if (flight.squadronId === undefined) delete flight.squadronId;
  if (flight.startOnGround === undefined) delete flight.startOnGround;
  ctx.flights.push(flight);
  return flight;
}

function genericMembers(ctx: GenCtx, n: number, aircraftId: AircraftId, nation: Nation, squadronId?: string): MissionFlightMember[] {
  return Array.from({ length: n }, (_, i) => ({
    skill: ctx.rng.weighted(ENEMY_SKILL[ctx.difficulty]),
    livery: composeLivery({ aircraftId, nation, date: ctx.date, squadronId, marking: markingFor(nation, i) }),
  }));
}

/** Enemy (or friendly AI) fighter flight drawn from a nearby squadron, possibly led by a historical ace. */
export function fighterFlight(
  ctx: GenCtx,
  opts: { side: Side; role: FlightRole; near: XZ; count: number; start: XZ; altitude: number; waypoints: Waypoint[]; task: MissionFlight['task']; spawnDelay?: number; escortFlightId?: string; aceChance?: number },
): MissionFlight {
  const { rng, date } = ctx;
  const cands = squadronsOfSide(opts.side, date)
    .map((s) => ({ s, d: dist(squadronBaseOn(s, date), opts.near) }))
    .filter((c) => c.d < 70_000);
  let squadron: SquadronInfo | undefined;
  if (cands.length) {
    squadron = rng.weighted(cands.map((c) => [c.s, (1 / (1 + c.d / 15_000)) * (1 + 0.6 * acesWith(ctx, c.s.id).length)] as const));
  }
  let aircraftId: AircraftId;
  let nation: Nation;
  const members: MissionFlightMember[] = [];
  if (squadron) {
    const types = squadronAircraftOn(squadron, date);
    aircraftId = rng.weighted(types.map((t, i) => [t, i === 0 ? 3 : 1] as const));
    nation = squadron.nation;
    const diffScale = ctx.difficulty === 'recruit' ? 0.5 : ctx.difficulty === 'ace' ? 1.3 : 1;
    const chance = (opts.aceChance ?? Math.min(0.4, 0.22 * (ctx.event?.intensity ?? 1))) * diffScale;
    const aces = rng.shuffle(acesWith(ctx, squadron.id)).filter(() => rng.chance(chance)).slice(0, opts.count > 4 ? 2 : 1);
    for (const ace of aces) {
      const t = aceAircraft(ace, date, types);
      if (members.length === 0 && t) aircraftId = t;
      members.push({
        pilotName: aceNamesOn(ace, date).short,
        aceId: ace.id,
        skill: 'ace',
        livery: composeLivery({ aircraftId, nation, date, squadronId: squadron.id, aceId: ace.id }),
      });
      if (opts.role === 'enemy') ctx.intel.aces.push(ace);
    }
    if (opts.role === 'enemy' && !ctx.intel.squadrons.includes(squadron)) ctx.intel.squadrons.push(squadron);
  } else {
    aircraftId = rng.pick(aircraftPool(opts.side, 'fighter', date));
    nation = nationForAircraft(aircraftId, opts.side);
  }
  members.push(...genericMembers(ctx, Math.max(0, opts.count - members.length), aircraftId, nation, squadron?.id));
  // Ace liveries were composed before the final type was known for the leader; recompose.
  for (const m of members) if (m.aceId) m.livery = composeLivery({ aircraftId, nation, date, squadronId: squadron?.id, aceId: m.aceId });
  return addFlight(ctx, {
    role: opts.role,
    side: opts.side,
    nation,
    aircraftId,
    squadronId: squadron?.id,
    members,
    start: opts.start,
    altitude: opts.altitude,
    waypoints: opts.waypoints,
    task: opts.task,
    spawnDelay: opts.spawnDelay,
    escortFlightId: opts.escortFlightId,
    idPrefix: opts.role === 'enemy' ? 'enemy' : 'friendly',
  });
}

/**
 * How briefings name a two-seater flight. The roster covers 1915-18 (B.E.2c, F.E.2b, Farman
 * F.40, Albatros C.III for the early war), but where a side has no type in service on the date a
 * later one stands in (aircraftPool; DECISIONS D-010) — name those generically.
 */
export function chargeNames(aircraftId: AircraftId, date: string): { plural: string; long: string; inService: boolean } {
  const spec = AIRCRAFT[aircraftId];
  const inService = spec.introduced <= date && date <= spec.retired;
  if (inService) return { plural: `${spec.shortName}s`, long: `${spec.name} machines`, inService };
  const kind = spec.role === 'bomber' ? 'bombers' : 'two-seaters';
  return { plural: kind, long: `observation ${kind}`, inService };
}

/** Two-seater reconnaissance or bomber flight. */
export function twoSeaterFlight(
  ctx: GenCtx,
  opts: { side: Side; role: FlightRole; count: number; start: XZ; altitude: number; waypoints: Waypoint[]; task: 'recon' | 'bomb'; spawnDelay?: number; preferNation?: Nation },
): MissionFlight {
  const all = aircraftPool(opts.side, opts.task === 'bomb' ? 'bomber' : 'recon', ctx.date);
  // Escort your own nation's machines when it flies any in service (a French pilot escorts Farmans).
  const own = opts.preferNation ? all.filter((id) => AIRCRAFT[id].nation === opts.preferNation || AIRCRAFT[id].alsoUsedBy.includes(opts.preferNation!)) : [];
  const pool = own.length ? own : all;
  const aircraftId = ctx.rng.pick(pool);
  const spec = AIRCRAFT[aircraftId];
  const nation = opts.preferNation && (spec.nation === opts.preferNation || spec.alsoUsedBy.includes(opts.preferNation)) ? opts.preferNation : nationForAircraft(aircraftId, opts.side);
  return addFlight(ctx, {
    role: opts.role,
    side: opts.side,
    nation,
    aircraftId,
    members: genericMembers(ctx, opts.count, aircraftId, nation),
    start: opts.start,
    altitude: opts.altitude,
    waypoints: opts.waypoints,
    task: spec.role === 'bomber' ? 'bomb' : opts.task,
    spawnDelay: opts.spawnDelay,
    idPrefix: opts.role === 'enemy' ? 'enemy' : 'friendly',
  });
}

export function addBalloon(ctx: GenCtx, side: Side, p: XZ): MissionBalloon {
  const b: MissionBalloon = { id: nextId(ctx, 'balloon', 'balloon'), side, x: Math.round(p.x), z: Math.round(p.z), altitude: Math.round(ctx.rng.range(800, 1200)) };
  ctx.balloons.push(b);
  return b;
}

export function addGround(ctx: GenCtx, type: GroundTargetType, side: Side, p: XZ, headingRad?: number): MissionGroundTarget {
  const g: MissionGroundTarget = {
    id: nextId(ctx, 'ground', 'gt'),
    type,
    side,
    x: Math.round(p.x),
    z: Math.round(p.z),
    heading: Math.round((headingRad ?? ctx.rng.range(0, Math.PI * 2)) * 1000) / 1000,
  };
  ctx.groundTargets.push(g);
  return g;
}

export function addObjective(ctx: GenCtx, o: Omit<MissionObjective, 'id'>): MissionObjective {
  const obj = { id: nextId(ctx, 'objective', 'obj'), ...o };
  ctx.objectives.push(obj);
  return obj;
}

/** Nudge p until it lies on `side` (small jitters can cross a bending line). */
export function ensureSide(ctx: GenCtx, p: XZ, side: Side, fp: FrontPoint): XZ {
  if (sideOfFrontAt(p.x, p.z, ctx.date) === side) return p;
  return pointOnSide(fp, side, Math.max(2000, dist(p, fp)), ctx.date);
}

export function jitter(ctx: GenCtx, p: XZ, r: number): XZ {
  return clampToSector({ x: p.x + ctx.rng.range(-r, r), z: p.z + ctx.rng.range(-r, r) });
}

/** Nearest active aerodrome of `side`, lying on that side of the lines. */
export function nearestAerodrome(ctx: GenCtx, side: Side, p: XZ, exclude?: string): AerodromeWorld | undefined {
  return aerodromesActiveOn(ctx.date)
    .filter((a) => a.side === side && a.id !== exclude && sideOfFrontAt(a.x, a.z, ctx.date) === side)
    .sort((a, b) => dist(a, p) - dist(b, p))[0];
}

export function enemyCount(ctx: GenCtx, base: number): number {
  const y = yearOf(ctx.date);
  const yearAdd = y <= 1915 ? -1 : y === 1916 ? 0 : y === 1917 ? 1 : 2;
  const diffAdd = ctx.difficulty === 'recruit' ? -1 : ctx.difficulty === 'ace' ? 1 : 0;
  const intensity = ctx.event?.intensity ?? 1;
  const n = Math.round((base + yearAdd + diffAdd + ctx.rng.int(-1, 1)) * (0.8 + 0.2 * intensity));
  // Keep the odds fightable: at most one more than the player's flight (two on 'ace').
  const cap = ctx.playerFlightSize + (ctx.difficulty === 'ace' ? 2 : 1);
  return Math.max(1, Math.min(6, cap, n));
}

/**
 * Spawn delay (s) for a flight starting at `from` so it reaches `meet` about when the player does
 * after flying `playerPath` then `meet` (+`extra` seconds), give or take `jitter`. Keeps the first
 * contact within a few minutes of the start, as in RB2, instead of leaving the player alone for ten.
 */
export function meetDelay(ctx: GenCtx, playerPath: readonly XZ[], meet: XZ, from: XZ, extra = 0, jitter: readonly [number, number] = [-45, 15]): number {
  const v = ctx.playerAircraft ? cruiseSpeed(ctx.playerAircraft) : 45;
  const pts = [...playerPath, meet];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  const t = d / v + extra - dist(from, meet) / v + ctx.rng.range(jitter[0], jitter[1]);
  return Math.round(Math.max(0, Math.min(900, t)));
}

// ---------------------------------------------------------------------------
// Career mission
// ---------------------------------------------------------------------------

function pickMissionType(ctx: GenCtx, aircraftId: AircraftId): MissionType {
  const y = yearOf(ctx.date);
  const w: Partial<Record<MissionType, number>> = {
    patrol: 30,
    'free-hunt': 8,
    escort: 14,
    intercept: 14,
    'balloon-attack': 8,
    'balloon-defense': 6,
    'ground-attack': y >= 1918 ? 12 : y === 1917 ? 6 : 2,
    'airfield-attack': y >= 1918 ? 4 : y === 1917 ? 1.5 : 0,
  };
  if (ctx.side === 'central') {
    w.patrol! -= 8;
    w.intercept! += 8;
    w['balloon-defense']! += 4;
    w['free-hunt']! += 8;
  } else {
    w.patrol! += 5;
    w.escort! += 4;
  }
  if (AIRCRAFT[aircraftId].role === 'two-seater') {
    w.escort! -= 6;
    w['ground-attack']! += 8;
    w['balloon-attack'] = 3;
  }
  if (ctx.date < '1916-03-01') {
    w['balloon-attack'] = 2;
    w['balloon-defense'] = 1;
    w['ground-attack'] = 0;
  }
  for (const t of ctx.event?.emphasis ?? []) if (w[t] !== undefined) w[t] = w[t]! * 1.6;
  return ctx.rng.weighted(Object.entries(w) as [MissionType, number][]);
}

interface PlayerSetup {
  pilot: CareerPilot;
  squadron: SquadronInfo;
  aircraftId: AircraftId;
  home: AerodromeWorld;
  startOnGround: boolean;
}

/** The parts of a stored personal livery that follow the pilot between aircraft types. */
export function personalOverrides(l: CareerPilot['personalLivery']): Partial<Livery> | undefined {
  if (!l) return undefined;
  return { fuselage: l.fuselage, tail: l.tail, cowling: l.cowling, accent: l.accent, marking: l.marking };
}

/** Wingmen for the player's flight on this date/type (the flight size drives enemy numbers). */
function rollWingmen(ctx: GenCtx, aircraftId: AircraftId): number {
  const y = yearOf(ctx.date);
  const [lo, hi] = AIRCRAFT[aircraftId].role === 'two-seater' ? [1, 3] : y <= 1915 ? [0, 1] : y === 1916 ? [1, 3] : y === 1917 ? [2, 4] : [3, 5];
  return ctx.rng.int(lo, hi);
}

function playerMembers(ctx: GenCtx, s: PlayerSetup): MissionFlightMember[] {
  const { pilot, squadron, aircraftId } = s;
  const rank = getRank(pilot.rankId);
  const mates = ctx.playerFlightSize - 1;
  const members: MissionFlightMember[] = [
    {
      pilotName: `${rank?.abbrev ?? ''} ${pilot.firstName[0] ?? ''}. ${pilot.lastName}`.trim(),
      skill: 'veteran',
      isPlayer: true,
      livery: composeLivery({ aircraftId, nation: pilot.nation, date: ctx.date, squadronId: squadron.id, personal: personalOverrides(pilot.personalLivery), marking: markingFor(pilot.nation, 0) }),
    },
  ];
  const aces = acesWith(ctx, squadron.id).filter(() => ctx.rng.chance(0.7)).slice(0, Math.min(2, mates));
  for (const ace of aces) {
    members.push({ pilotName: aceNamesOn(ace, ctx.date).short, aceId: ace.id, skill: 'ace', livery: composeLivery({ aircraftId, nation: pilot.nation, date: ctx.date, squadronId: squadron.id, aceId: ace.id }) });
  }
  // The fallen and the captured don't come back: draw a bigger roster and leave them out.
  // Match without the rank: next quarter's roster may have promoted him.
  const bare = (name: string) => /(?:^|\s)(\p{Lu}\. .+)$/u.exec(name)?.[1] ?? name;
  const lost = new Set((pilot.lostMates ?? []).map(bare));
  // The surname pool holds about 28 names per nation; stay well inside it.
  const roster = squadronRoster(pilot.rngSeed, squadron.id, pilot.nation, ctx.date, pilot.difficulty, Math.min(8 + lost.size, 22), pilot.lastName).filter((r) => !lost.has(bare(r.name))).slice(0, 8);
  const picks = ctx.rng.shuffle(roster).slice(0, mates - aces.length);
  for (const r of picks) {
    members.push({ pilotName: r.name, skill: r.skill, livery: composeLivery({ aircraftId, nation: pilot.nation, date: ctx.date, squadronId: squadron.id, marking: markingFor(pilot.nation, members.length) }) });
  }
  return members;
}

interface Plan {
  type: MissionType;
  title: string;
  orders: string;
  playerWaypoints: Waypoint[];
  playerStart: XZ;
  playerAltitude: number;
  playerTask: MissionFlight['task'];
  escortFlightId?: string;
}

const TITLES: Record<MissionType, Record<Side, string>> = {
  patrol: { allied: 'Offensive Patrol', central: 'Barrier Patrol' },
  'free-hunt': { allied: 'Roving Commission', central: 'Free Hunt' },
  escort: { allied: 'Escort', central: 'Escort' },
  intercept: { allied: 'Interception', central: 'Interception' },
  'balloon-attack': { allied: 'Balloon Strafe', central: 'Balloon Attack' },
  'balloon-defense': { allied: 'Balloon Defence', central: 'Balloon Defence' },
  'ground-attack': { allied: 'Ground Strafing', central: 'Infantry Support' },
  'airfield-attack': { allied: 'Aerodrome Raid', central: 'Aerodrome Raid' },
  dogfight: { allied: 'Dogfight', central: 'Dogfight' },
};

function planMission(ctx: GenCtx, type: MissionType, s: PlayerSetup, fp: FrontPoint, playerFlightId: string): Plan {
  const { rng, date, side, enemySide } = ctx;
  const alt = patrolAltitude(ctx, s.aircraftId);
  // Pacing (DECISIONS: contact within ~1.5-3 min): the flight starts in the air a short
  // ferry behind the lines, lined up with where it crosses them, rather than far back and
  // off to one side. The full ferry from the aerodrome is the startOnGround option.
  const ingressLat = rng.range(-2000, 2000);
  const start = pointOnSide(fp, side, START_BEHIND_LINES_M, date, ingressLat);
  const ingress = pointOnSide(fp, side, 1500, date, ingressLat);
  const home: Waypoint = wp(s.home, terrainHeightAt(s.home.x, s.home.z) + 300, 'land', { label: s.home.name });
  const eAlt = () => Math.max(800, alt + rng.range(-600, 700));
  const title = (where: XZ) => `${TITLES[type][side]} ${describeLocation(where)}`;

  switch (type) {
    case 'patrol':
    case 'free-hunt': {
      const deep = type === 'free-hunt';
      const patrolSide = side === 'allied' || deep ? enemySide : side;
      const d = deep ? rng.range(3000, 7000) : patrolSide === enemySide ? rng.range(1500, 4000) : rng.range(1000, 2500);
      // An 8 km patrol line whose near end is where the flight crosses the lines.
      const dirLat = rng.chance(0.5) ? 1 : -1;
      const p1 = pointOnSide(fp, patrolSide, d, date, ingressLat - dirLat * 1500);
      const p2 = pointOnSide(fp, patrolSide, d, date, ingressLat + dirLat * 6500);
      // Name the patrol line's ends by where they really lie (-Z is north), not by leg order.
      const p1North = p1.z <= p2.z;
      const wps = deep
        ? [wp(ingress, alt, 'fly', { label: 'Cross the lines' }), wp(p1, alt, 'patrol', { duration: 300, label: 'Hunting ground' }), wp(ingress, alt, 'fly', { label: 'Recross the lines' }), home]
        : [
            wp(ingress, alt, 'fly', { label: 'The lines' }),
            wp(p1, alt, 'patrol', { duration: 120, label: `Patrol line (${p1North ? 'north' : 'south'})` }),
            wp(p2, alt, 'patrol', { duration: 120, label: `Patrol line (${p1North ? 'south' : 'north'})` }),
            home,
          ];
      const enemyStart = pointOnSide(fp, enemySide, 6000, date, ingressLat + rng.range(-4000, 4000));
      const e1 = fighterFlight(ctx, {
        side: enemySide, role: 'enemy', near: fp, count: enemyCount(ctx, 3), start: enemyStart, altitude: eAlt(),
        waypoints: [wp(p1, eAlt(), 'patrol', { duration: 400 }), wp(p2, eAlt(), 'patrol', { duration: 200 }), wp(enemyStart, eAlt(), 'fly')],
        task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [start, ingress], p1, enemyStart),
      });
      const targets = [e1.id];
      if (rng.chance(yearOf(date) >= 1917 ? 0.5 : 0.3)) {
        const recon = rng.chance(0.5);
        const s2 = pointOnSide(fp, enemySide, 8000, date, rng.range(-10000, 10000));
        const tgt = pointOnSide(fp, side, rng.range(2000, 5000), date, rng.range(-6000, 6000));
        const f2 = recon
          ? twoSeaterFlight(ctx, { side: enemySide, role: 'enemy', count: rng.int(1, 2), start: s2, altitude: eAlt(), waypoints: [wp(tgt, eAlt(), 'patrol', { duration: 90 }), wp(s2, eAlt(), 'fly')], task: 'recon', spawnDelay: meetDelay(ctx, [start, ingress, p1], tgt, s2, 60) })
          : fighterFlight(ctx, { side: enemySide, role: 'enemy', near: fp, count: enemyCount(ctx, 2), start: s2, altitude: eAlt(), waypoints: [wp(p2, eAlt(), 'patrol', { duration: 300 }), wp(s2, eAlt(), 'fly')], task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [start, ingress, p1], p2, s2, 120) });
        targets.push(f2.id);
      }
      if (deep) {
        addObjective(ctx, { kind: 'destroy-aircraft', description: 'Bring down at least one enemy machine.', targetIds: targets, count: 1, primary: true });
      } else {
        addObjective(ctx, { kind: 'patrol-area', description: `Hold the patrol line for ${Math.round(PATROL_STATION_S / 60)} minutes, or engage the enemy there.`, targetIds: [`${playerFlightId}:1`, `${playerFlightId}:2`], count: PATROL_STATION_S, primary: true });
        addObjective(ctx, { kind: 'destroy-aircraft', description: 'Engage any enemy machines encountered.', targetIds: targets, count: 1, primary: false });
      }
      const where = describeLocation(p1);
      const orders = deep
        ? `You have a free hand today. Cross the lines ${describeLocation(ingress)} at ${fmtAlt(ctx, alt)} and hunt ${where}. Pick your fights: height and the sun are your friends.`
        : side === 'allied'
          ? `Carry out an offensive patrol ${where}, between ${fmtAlt(ctx, alt - 300)} and ${fmtAlt(ctx, alt + 300)}, keeping well east of the lines. Hold the patrol line for at least ${Math.round(PATROL_STATION_S / 60)} minutes and engage all hostile machines met with.`
          : `Fly a barrier patrol along our side of the lines ${where} at ${fmtAlt(ctx, alt)}. Hold the line for at least ${Math.round(PATROL_STATION_S / 60)} minutes: no enemy machine is to cross into our sector unmolested.`;
      return { type, title: title(p1), orders, playerWaypoints: wps, playerStart: start, playerAltitude: alt, playerTask: 'fighter-sweep' };
    }

    case 'escort': {
      const target = pointOnSide(fp, enemySide, rng.range(3500, 7000), date, ingressLat + rng.range(-3000, 3000));
      const rendezvous = pointOnSide(fp, side, 3000, date, ingressLat);
      const egress = pointOnSide(fp, side, 2500, date, ingressLat + rng.range(-3000, 3000));
      const bomb = yearOf(date) >= 1917 && rng.chance(0.4);
      const theirBase = nearestAerodrome(ctx, side, rendezvous, s.home.id) ?? s.home;
      const ts = twoSeaterFlight(ctx, {
        side, role: 'friendly', count: rng.int(2, 4), start: rendezvous, altitude: alt - 300, preferNation: ctx.nation,
        waypoints: [wp(target, alt - 300, bomb ? 'fly' : 'patrol', { duration: bomb ? undefined : 90, label: bomb ? 'Bomb target' : 'Photograph target' }), wp(egress, alt - 300, 'fly'), wp(theirBase, 400, 'land', { label: theirBase.name })],
        task: bomb ? 'bomb' : 'recon',
      });
      const start2 = ensureSide(ctx, add(rendezvous, { x: -(target.x - rendezvous.x) / Math.max(1, dist(target, rendezvous)), z: -(target.z - rendezvous.z) / Math.max(1, dist(target, rendezvous)) }, 1500), side, fp);
      const enemyStart = pointOnSide(fp, enemySide, 7000, date, ingressLat + rng.range(-5000, 5000));
      fighterFlight(ctx, {
        side: enemySide, role: 'enemy', near: target, count: enemyCount(ctx, 3), start: enemyStart, altitude: eAlt(),
        waypoints: [wp(target, eAlt(), 'patrol', { duration: 300 }), wp(enemyStart, eAlt(), 'fly')], task: 'defend', spawnDelay: meetDelay(ctx, [start2, rendezvous], target, enemyStart, 0, [-90, -10]),
      });
      if (yearOf(date) >= 1917 && rng.chance(0.4)) {
        const s2 = pointOnSide(fp, enemySide, 8000, date, rng.range(-8000, 8000));
        fighterFlight(ctx, { side: enemySide, role: 'enemy', near: target, count: enemyCount(ctx, 2), start: s2, altitude: eAlt(), waypoints: [wp(egress, eAlt(), 'patrol', { duration: 200 }), wp(s2, eAlt(), 'fly')], task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [start2, rendezvous, target], egress, s2) });
      }
      const n = ts.members.length;
      const charge = chargeNames(ts.aircraftId, date);
      addObjective(ctx, { kind: 'protect-flight', description: `See at least ${Math.ceil(n / 2)} of the ${n} ${charge.plural} safely home.`, targetIds: [ts.id], count: Math.ceil(n / 2), primary: true });
      const meetAt = describeLocation(rendezvous);
      const objectiveAt = describeLocation(target) === meetAt ? `${Math.round(dist(rendezvous, target) / 1000)} km beyond the lines` : describeLocation(target);
      const orders = `Rendezvous with ${n} ${charge.long} ${meetAt} at ${fmtAlt(ctx, alt)} and escort them to their objective ${objectiveAt}. ${bomb ? 'They carry bombs for the enemy\'s billets and dumps.' : 'They are to photograph the enemy\'s rear areas.'} Stay with your charges - they are your only concern.`;
      return {
        type, title: title(target), orders, playerStart: start2, playerAltitude: alt, playerTask: 'escort', escortFlightId: ts.id,
        playerWaypoints: [wp(rendezvous, alt, 'rendezvous', { label: 'Rendezvous' }), wp(target, alt, 'fly', { label: 'Objective' }), wp(egress, alt, 'fly', { label: 'The lines' }), home],
      };
    }

    case 'intercept': {
      const tgtDepth = rng.range(2500, 5000);
      const tgtLat = ingressLat + rng.range(-3000, 3000);
      const eStart = pointOnSide(fp, enemySide, 3500, date, tgtLat + rng.range(-5000, 5000));
      const tgt = pointOnSide(fp, side, tgtDepth, date, tgtLat);
      const eBack = pointOnSide(fp, enemySide, 6000, date, rng.range(-6000, 6000));
      // Scrambled to meet them: start between the aerodrome and their objective.
      const iStart = pointOnSide(fp, side, tgtDepth + 3000, date, tgtLat);
      const a = eAlt();
      const ts = twoSeaterFlight(ctx, { side: enemySide, role: 'enemy', count: rng.int(1, 3), start: eStart, altitude: a, waypoints: [wp(tgt, a, 'patrol', { duration: 150, label: 'Enemy objective' }), wp(eBack, a, 'fly')], task: 'recon', spawnDelay: meetDelay(ctx, [iStart], tgt, eStart, 0, [-100, -30]) });
      const escortChance = yearOf(date) <= 1916 ? 0.3 : yearOf(date) === 1917 ? 0.5 : 0.6;
      if (rng.chance(escortChance)) {
        fighterFlight(ctx, { side: enemySide, role: 'enemy', near: tgt, count: enemyCount(ctx, 2), start: add(eStart, { x: 0, z: 1 }, 600), altitude: a + 400, waypoints: [wp(tgt, a + 400, 'patrol', { duration: 150 }), wp(eBack, a + 400, 'fly')], task: 'escort', escortFlightId: ts.id, spawnDelay: ts.spawnDelay });
      }
      const quarry = chargeNames(ts.aircraftId, date);
      addObjective(ctx, { kind: 'destroy-aircraft', description: `Destroy the enemy ${quarry.inService ? `${AIRCRAFT[ts.aircraftId].shortName} ` : ''}two-seater${ts.members.length > 1 ? 's' : ''}.`, targetIds: [ts.id], count: 1, primary: true });
      const orders = `Our observers report enemy two-seaters ranging for their artillery ${describeLocation(tgt)}. Climb to ${fmtAlt(ctx, a)}, find them, and bring them down before they can take their photographs home.`;
      return { type, title: title(tgt), orders, playerStart: iStart, playerAltitude: alt, playerTask: 'fighter-sweep', playerWaypoints: [wp(tgt, a, 'patrol', { duration: 240, label: 'Interception area' }), home] };
    }

    case 'balloon-attack': {
      const n = rng.int(2, 3);
      const d = rng.range(3000, 5500);
      const lat0 = ingressLat + rng.range(-2000, 2000);
      const balloons = Array.from({ length: n }, (_, i) => addBalloon(ctx, enemySide, pointOnSide(fp, enemySide, d + rng.range(-800, 800), date, lat0 + (i - (n - 1) / 2) * rng.range(1500, 3000))));
      for (const b of balloons) {
        for (let k = 0; k < 2; k++) addGround(ctx, 'aa-gun', enemySide, ensureSide(ctx, jitter(ctx, b, 350), enemySide, fp));
      }
      const c = centroid(balloons);
      if (rng.chance(0.6)) {
        const ds = pointOnSide(fp, enemySide, d + 3000, date, lat0);
        fighterFlight(ctx, { side: enemySide, role: 'enemy', near: c, count: enemyCount(ctx, 2), start: ds, altitude: terrainHeightAt(ds.x, ds.z) + 500, waypoints: [wp(c, terrainHeightAt(c.x, c.z) + 1200, 'patrol', { duration: 600, label: 'Balloon line' })], task: 'defend', spawnDelay: meetDelay(ctx, [start, ingress], c, ds, 40, [0, 40]) }); // scrambled as the attack goes in
      }
      const ids = balloons.map((b) => b.id);
      addObjective(ctx, { kind: 'destroy-balloons', description: 'Flame at least one enemy observation balloon.', targetIds: ids, count: 1, primary: true });
      addObjective(ctx, { kind: 'destroy-balloons', description: `Destroy all ${n} balloons.`, targetIds: ids, count: n, primary: false });
      const orders = `The enemy\'s observation balloons ${describeLocation(c)} are directing his guns onto our trenches. Go in fast and low, flame them, and get out. Expect heavy fire from the ground: the balloon lines are ringed with anti-aircraft guns and machine guns.`;
      return {
        type, title: title(c), orders, playerStart: start, playerAltitude: alt, playerTask: 'balloon-attack',
        playerWaypoints: [wp(ingress, alt, 'fly', { label: 'The lines' }), wp(c, terrainHeightAt(c.x, c.z) + 1000, 'attack-balloon', { targetIds: ids, label: 'Balloon line' }), wp(ingress, 800, 'fly', { label: 'Home side' }), home],
      };
    }

    case 'balloon-defense': {
      const n = rng.int(2, 3);
      const d = rng.range(2500, 4500);
      const lat0 = ingressLat + rng.range(-2000, 2000);
      const balloons = Array.from({ length: n }, (_, i) => addBalloon(ctx, side, pointOnSide(fp, side, d + rng.range(-800, 800), date, lat0 + (i - (n - 1) / 2) * rng.range(1500, 3000))));
      for (const b of balloons) addGround(ctx, 'aa-gun', side, ensureSide(ctx, jitter(ctx, b, 350), side, fp));
      const c = centroid(balloons);
      const ids = balloons.map((b) => b.id);
      const es = pointOnSide(fp, enemySide, 4500, date, lat0 + rng.range(-4000, 4000));
      const e1 = fighterFlight(ctx, { side: enemySide, role: 'enemy', near: c, count: enemyCount(ctx, 2), start: es, altitude: 2000, waypoints: [wp(c, 1200, 'attack-balloon', { targetIds: ids }), wp(es, 1500, 'fly')], task: 'balloon-attack', spawnDelay: meetDelay(ctx, [start], c, es, 40, [0, 60]), aceChance: 0.25 });
      const targets = [e1.id];
      if (rng.chance(0.35)) {
        const es2 = pointOnSide(fp, enemySide, 7000, date, rng.range(-6000, 6000));
        targets.push(fighterFlight(ctx, { side: enemySide, role: 'enemy', near: c, count: enemyCount(ctx, 2), start: es2, altitude: eAlt(), waypoints: [wp(c, eAlt(), 'patrol', { duration: 300 }), wp(es2, eAlt(), 'fly')], task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [start], c, es2, 150) }).id);
      }
      addObjective(ctx, { kind: 'protect-balloons', description: `Keep at least ${Math.max(1, n - 1)} of our ${n} balloons aloft.`, targetIds: ids, count: Math.max(1, n - 1), primary: true });
      addObjective(ctx, { kind: 'destroy-aircraft', description: 'Destroy the balloon attackers.', targetIds: targets, count: 1, primary: false });
      const orders = `Enemy scouts have been shooting down our balloons ${describeLocation(c)}. Patrol above the balloon line at ${fmtAlt(ctx, 1500)} and drive off any attackers. Mind our own anti-aircraft gunners - they are not particular.`;
      return { type, title: title(c), orders, playerStart: start, playerAltitude: Math.min(alt, 2500), playerTask: 'defend', playerWaypoints: [wp(c, 1500, 'patrol', { duration: 480, label: 'Balloon line' }), home] };
    }

    case 'airfield-attack': {
      const field = nearestAerodrome(ctx, enemySide, fp);
      if (!field || dist(field, fp) > 45_000) return planMission(ctx, 'ground-attack', s, fp, playerFlightId);
      const rwy = (field.runwayHeadingDeg * Math.PI) / 180;
      const perp = { x: Math.cos(rwy), z: Math.sin(rwy) };
      const along = { x: Math.sin(rwy), z: -Math.cos(rwy) };
      const hangarIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = add(add(field, perp, 180 + rng.range(0, 60)), along, (i - 1.5) * 60);
        hangarIds.push(addGround(ctx, i < 2 ? 'hangar' : 'tent-hangar', enemySide, p, rwy).id);
      }
      addGround(ctx, 'supply-dump', enemySide, add(field, perp, 320), rwy);
      for (let k = 0; k < 2; k++) addGround(ctx, 'aa-gun', enemySide, jitter(ctx, add(field, perp, -250), 200));
      fighterFlight(ctx, { side: enemySide, role: 'enemy', near: field, count: enemyCount(ctx, 2), start: field, altitude: terrainHeightAt(field.x, field.z) + 600, waypoints: [wp(field, 1200, 'patrol', { duration: 600, label: field.name })], task: 'defend', spawnDelay: meetDelay(ctx, [start, ingress], field, field, -60, [-20, 20]), aceChance: 0.2 });
      addObjective(ctx, { kind: 'destroy-ground', description: `Destroy at least two hangars at ${field.name}.`, targetIds: hangarIds, count: 2, primary: true });
      const orders = `The enemy\'s aerodrome at ${field.name} is to be attacked. Cross the lines at ${fmtAlt(ctx, alt)}, then dive on the sheds and machines on the ground. His scouts will be taking off to meet you - hit hard and leave fast.`;
      return { type, title: `${TITLES[type][side]}: ${field.name}`, orders, playerStart: start, playerAltitude: alt, playerTask: 'ground-attack', playerWaypoints: [wp(ingress, alt, 'fly', { label: 'The lines' }), wp(field, terrainHeightAt(field.x, field.z) + 300, 'attack-ground', { targetIds: hangarIds, label: field.name }), wp(ingress, 1200, 'fly', { label: 'Home side' }), home] };
    }

    case 'ground-attack':
    default: {
      const lat = ingressLat + rng.range(-2000, 2000);
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) ids.push(addGround(ctx, 'trench-mg', enemySide, pointOnSide(fp, enemySide, rng.range(500, 1200), date, lat + rng.range(-600, 600))).id);
      for (let i = 0; i < rng.int(2, 3); i++) ids.push(addGround(ctx, 'artillery', enemySide, pointOnSide(fp, enemySide, rng.range(2500, 4000), date, lat + i * 120)).id);
      const road = pointOnSide(fp, enemySide, rng.range(3000, 5000), date, lat + rng.range(-1500, 1500));
      const roadHeading = heading(road, add(road, enemyDirection(fp, side), 1));
      for (let i = 0; i < 3; i++) ids.push(addGround(ctx, 'truck', enemySide, ensureSide(ctx, add(road, enemyDirection(fp, side), i * 40), enemySide, fp), roadHeading).id);
      addGround(ctx, 'aa-gun', enemySide, pointOnSide(fp, enemySide, 2000, date, lat + 800));
      const c = centroid(ctx.groundTargets.filter((g) => ids.includes(g.id)));
      if (rng.chance(0.5)) {
        const es = pointOnSide(fp, enemySide, 6000, date, lat);
        fighterFlight(ctx, { side: enemySide, role: 'enemy', near: c, count: enemyCount(ctx, 2), start: es, altitude: terrainHeightAt(es.x, es.z) + 500, waypoints: [wp(c, terrainHeightAt(c.x, c.z) + 500, 'patrol', { duration: 400 }), wp(es, eAlt(), 'fly')], task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [start, ingress], c, es, 120, [0, 60]) });
      }
      addObjective(ctx, { kind: 'destroy-ground', description: `Destroy at least ${Math.ceil(ids.length / 3)} targets: machine-gun posts, batteries and transport.`, targetIds: ids, count: Math.ceil(ids.length / 3), primary: true });
      addObjective(ctx, { kind: 'destroy-ground', description: 'Destroy every target.', targetIds: ids, count: ids.length, primary: false });
      const orders = `Go down and strafe the enemy\'s forward positions ${describeLocation(c)}: machine-gun posts in the front line, a battery behind it, and transport on the roads. Keep moving and do not linger over the trenches - every rifle in the line will be firing at you.`;
      return { type: 'ground-attack', title: `${TITLES['ground-attack'][side]} ${describeLocation(c)}`, orders, playerStart: start, playerAltitude: Math.min(alt, 2000), playerTask: 'ground-attack', playerWaypoints: [wp(ingress, 1500, 'fly', { label: 'The lines' }), wp(c, terrainHeightAt(c.x, c.z) + 300, 'attack-ground', { targetIds: ids, label: 'Targets' }), wp(ingress, 1000, 'fly', { label: 'Home side' }), home] };
    }
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function centroid(ps: readonly XZ[]): XZ {
  const n = Math.max(1, ps.length);
  return { x: ps.reduce((s, p) => s + p.x, 0) / n, z: ps.reduce((s, p) => s + p.z, 0) / n };
}

const SIGN_OFF: Record<Nation, string> = {
  germany: 'Hals- und Beinbruch!',
  britain: 'Good hunting, and good luck.',
  france: 'Bonne chasse !',
  usa: 'Give \'em hell.',
};

function intelParagraph(ctx: GenCtx): string {
  const parts: string[] = [];
  const sq = ctx.intel.squadrons[0];
  if (sq) parts.push(`Intelligence reports the machines of ${sq.shortName} active in this sector${sq.motto && ctx.side === 'allied' && sq.nation === 'germany' ? ` - ${sq.motto.toLowerCase()}` : ''}.`);
  const ace = ctx.intel.aces[0];
  if (ace && ctx.rng.chance(0.7)) parts.push(`Be warned: ${aceNamesOn(ace, ctx.date).display}${ace.nickname ? `, "${ace.nickname}",` : ''} has been seen over this part of the front.`);
  return parts.join(' ');
}

export function generateCareerMission(pilot: CareerPilot, aircraftChoice: AircraftId | undefined, options: GenerateOptions = {}): MissionDefinition {
  const squadron = getSquadronInfo(pilot.squadronId);
  if (!squadron) throw new Error(`Unknown squadron ${pilot.squadronId}`);
  const date = pilot.date;
  const available = squadronAircraftOn(squadron, date);
  if (!available.length) throw new Error(`${squadron.shortName} has no aircraft on ${date}`);
  const aircraftId =
    aircraftChoice && available.includes(aircraftChoice) ? aircraftChoice : pilot.preferredAircraft && available.includes(pilot.preferredAircraft) ? pilot.preferredAircraft : available[0];
  const unavailable = Object.keys(pilot.alteredAces ?? {});
  const ctx = newCtx(seedFrom(pilot.rngSeed, pilot.missionsFlown, date, 'mission'), date, NATION_SIDE[pilot.nation], pilot.nation, pilot.difficulty, unavailable);
  const home = squadronBaseOn(squadron, date);
  const setup: PlayerSetup = { pilot, squadron, aircraftId, home, startOnGround: !!options.startOnGround };

  const fp = frontAnchor(home, date, ctx.rng.range(-15000, 15000));
  const type = pickMissionType(ctx, aircraftId);
  const playerFlightId = 'player-1';
  // Reserve the player flight id so objective references are stable.
  ctx.counters.flight = 0;
  ctx.playerFlightSize = 1 + rollWingmen(ctx, aircraftId);
  ctx.playerAircraft = aircraftId;
  const plan = planMission(ctx, type, setup, fp, playerFlightId);

  const members = playerMembers(ctx, setup);
  const groundAlt = terrainHeightAt(home.x, home.z);
  const playerFlight: MissionFlight = {
    id: playerFlightId,
    role: 'player-flight',
    side: ctx.side,
    nation: pilot.nation,
    aircraftId,
    squadronId: squadron.id,
    members,
    start: setup.startOnGround
      ? { x: Math.round(home.x), z: Math.round(home.z), altitude: Math.round(groundAlt), heading: (home.runwayHeadingDeg * Math.PI) / 180, airspeed: 0 }
      : { x: Math.round(plan.playerStart.x), z: Math.round(plan.playerStart.z), altitude: Math.round(plan.playerAltitude), heading: heading(plan.playerStart, plan.playerWaypoints[0]), airspeed: Math.round(cruiseSpeed(aircraftId)) },
    waypoints: plan.playerWaypoints,
    task: plan.playerTask,
  };
  if (setup.startOnGround) playerFlight.startOnGround = true;
  if (plan.escortFlightId) playerFlight.escortFlightId = plan.escortFlightId;

  // Occasionally another friendly patrol shares the sky.
  if (yearOf(date) >= 1917 && ctx.rng.chance(0.25)) {
    const fs = pointOnSide(fp, ctx.side, 6000, date, ctx.rng.range(-10000, 10000));
    const fa = patrolAltitude(ctx, aircraftId);
    fighterFlight(ctx, { side: ctx.side, role: 'friendly', near: fs, count: ctx.rng.int(2, 4), start: fs, altitude: fa, waypoints: [wp(pointOnSide(fp, ctx.side, 1500, date, ctx.rng.range(-8000, 8000)), fa, 'patrol', { duration: 400 }), wp(fs, fa, 'fly')], task: 'fighter-sweep', spawnDelay: Math.round(ctx.rng.range(0, 200)), aceChance: 0.15 });
  }

  const timeOfDay = randomTimeOfDay(ctx.rng);
  const weather = seasonalWeather(date, ctx.rng);
  const lang = pilot.nation === 'germany' ? 'de' : pilot.nation === 'france' ? 'fr' : 'en';
  const rank = getRank(pilot.rankId);
  const wingmen = members.length - 1;
  const paragraphs = [
    `${squadron.name}, ${home.name}. ${formatLongDate(date, lang)}.`,
    ctx.event ? `${ctx.event.title}: ${ctx.event.briefing[ctx.side]}` : '',
    `${rank?.abbrev ?? ''} ${pilot.lastName}, ${lowerFirst(plan.orders)}${wingmen > 0 ? ` You will lead a flight of ${wingmen + 1} ${AIRCRAFT[aircraftId].shortName}s${members.some((m) => m.aceId && !m.isPlayer) ? `, with ${members.filter((m) => m.aceId && !m.isPlayer).map((m) => m.pilotName).join(' and ')} flying in your flight` : ''}.` : ` You will fly alone.`}`,
    intelParagraph(ctx),
    `Weather: ${describeWeather(weather, ctx.imperial)}`,
    SIGN_OFF[pilot.nation],
  ].filter(Boolean);

  return {
    id: `c-${pilot.id}-${pilot.missionsFlown + 1}`,
    type: plan.type,
    title: plan.title,
    briefing: paragraphs.join('\n\n'),
    date,
    timeOfDay,
    weather,
    flights: [playerFlight, ...ctx.flights],
    balloons: ctx.balloons,
    groundTargets: ctx.groundTargets,
    objectives: ctx.objectives,
    homeAerodromeId: home.id,
    isCareer: true,
  };
}

