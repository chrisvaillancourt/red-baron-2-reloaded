/**
 * Mission director: objectives, kill credit, radio chatter, end conditions,
 * and the final MissionResult. Listens on the session event bus.
 */
import { Vector3 } from 'three';
import type { EventBus } from '../core/interfaces';
import type {
  AircraftEntity,
  AircraftOutcome,
  MissionObjective,
  MissionResult,
  PilotFate,
  VictoryClaim,
} from '../core/types';
import { getAerodrome } from '../data/aerodromes';
import type { SessionWorld } from './world';

export const DESTROYED_OUTCOMES: ReadonlySet<AircraftOutcome> = new Set([
  'shot-down',
  'crashed',
  'collided',
  'pilot-killed',
  'ditched',
]);

/** Out of the fight from its own side's perspective (destroyed or forced down behind enemy lines). */
export function isLost(ac: AircraftEntity): boolean {
  return ac.outcome !== null && (DESTROYED_OUTCOMES.has(ac.outcome) || ac.outcome === 'landed-enemy');
}

export const WITNESS_RANGE_M = 3000;
export const END_FLIGHT_SAFE_RANGE_M = 5000;
export const ENEMY_SIGHTED_RANGE_M = 5000;
const HOME_RADIUS_M = 2500;
const FATAL_IMPACT_SPEED = 45; // m/s

export type RadioSink = (from: string, text: string) => void;

export interface DirectorOptions {
  /** Delay (s) between the player's flight ending and the mission ending. */
  crashEndDelay?: number;
  landedEndDelay?: number;
  /**
   * Called once when the flight's job is settled (escort charges home or lost, intercept
   * targets down or escaped, balloons lost) and no enemy is near: SimCore orders the
   * player's flight home.
   */
  onRecall?: () => void;
}

/** Horizontal distance (m) from the patrol line that still counts as "on station". */
export const PATROL_STATION_RADIUS_M = 3000;
/** Hits by the player's flight on enemy aircraft that count as having engaged them. */
export const ENGAGED_HITS = 5;
/** An enemy target further than this from the player, over its own lines, has escaped. */
export const ESCAPE_RANGE_M = 15000;
/** Objective kinds whose settlement sends the flight home (patrols just fly their route). */
const RECALL_KINDS: ReadonlySet<MissionObjective['kind']> = new Set(['protect-flight', 'destroy-aircraft', 'protect-balloons']);
const RECALL_SAFE_RANGE_M = 4000;

/** Live per-mission progress that some objectives need (patrol station time, engagement). */
export interface ObjectiveProgress {
  stationTime: ReadonlyMap<string, number>;
  engaged: boolean;
}

export function clockPosition(from: AircraftEntity, target: Vector3): { clock: number; elevation: 'high' | 'low' | 'level' } {
  const s = from.state;
  const fwd = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
  const heading = Math.atan2(fwd.x, -fwd.z);
  const dx = target.x - s.position.x;
  const dz = target.z - s.position.z;
  const bearing = Math.atan2(dx, -dz);
  let rel = bearing - heading;
  rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let clock = Math.round((rel / (Math.PI * 2)) * 12);
  if (clock === 0) clock = 12;
  const dy = target.y - s.position.y;
  const horiz = Math.hypot(dx, dz);
  const elevation = dy > horiz * 0.15 ? 'high' : dy < -horiz * 0.15 ? 'low' : 'level';
  return { clock, elevation };
}

export class MissionDirector {
  readonly claims: VictoryClaim[] = [];
  readonly completedObjectives = new Set<string>();
  readonly failedObjectives = new Set<string>();
  /** Seconds the player has spent on station per patrol-area objective. */
  readonly stationTime = new Map<string, number>();
  /** Hits scored by the player's flight on enemy aircraft. */
  flightHits = 0;
  private flightKills = 0;
  /** Target flights of protect-flight objectives seen over enemy ground (they've been out). */
  private crossedLines = new Set<string>();
  private settled = false;
  private recalled = false;
  private readonly onRecall?: () => void;
  roundsFired = 0;
  hits = 0;
  ended = false;
  endedByPlayer = false;
  aborted = false;
  /** Seconds until the mission ends after the player's flight is over. */
  private endCountdown: number | null = null;
  private attackers = new Map<number, Set<number>>();
  private reported = new Set<number>();
  private seenOutcome = new Map<number, AircraftOutcome | null>();
  private sightedFlights = new Set<string>();
  private wingmanKills = new Map<string, number>();
  private lastPlayerSpeed = 0;
  private unsub: (() => void)[] = [];
  private readonly crashEndDelay: number;
  private readonly landedEndDelay: number;

  constructor(
    private readonly world: SessionWorld,
    private readonly bus: EventBus,
    private readonly radio: RadioSink,
    opts: DirectorOptions = {},
  ) {
    this.crashEndDelay = opts.crashEndDelay ?? 5;
    this.landedEndDelay = opts.landedEndDelay ?? 3;
    this.onRecall = opts.onRecall;
    const player = world.player;
    this.unsub.push(
      bus.on('gun-fired', (e) => {
        if (player && e.shooterId === player.id) this.roundsFired++;
      }),
      bus.on('bullet-hit', (e) => {
        if (player && e.shooterId === player.id) this.hits++;
        if (player) {
          const shooter = world.getEntity(e.shooterId);
          const target = world.getEntity(e.targetId);
          if (shooter?.kind === 'aircraft' && shooter.flightId === player.flightId && target?.kind === 'aircraft' && target.side !== player.side) this.flightHits++;
        }
        let set = this.attackers.get(e.targetId);
        if (!set) this.attackers.set(e.targetId, (set = new Set()));
        set.add(e.shooterId);
      }),
      bus.on('aircraft-destroyed', (e) => this.onAircraftDestroyed(e.victimId, e.killerId, e.position)),
      bus.on('balloon-destroyed', (e) => this.onBalloonDestroyed(e.balloonId, e.killerId, e.position)),
      bus.on('gun-jammed', (e) => {
        if (player && e.aircraftId === player.id) this.radio('', 'Gun jammed! Hammer the breech (clear jam) to free it.');
      }),
      bus.on('out-of-ammo', (e) => {
        if (player && e.aircraftId === player.id) this.radio('', 'Out of ammunition on that gun.');
      }),
      bus.on('fire-started', (e) => {
        if (player && e.aircraftId === player.id) this.radio('', 'Fire! Side-slip to keep the flames off you and get down fast.');
      }),
      bus.on('engine-dead', (e) => {
        if (player && e.aircraftId === player.id) this.radio('', 'Engine has quit. Find a field.');
      }),
    );
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
  }

  /** Mark a destruction as already reported (so outcome-transition detection doesn't double count). */
  wasReported(id: number): boolean {
    return this.reported.has(id);
  }

  private onAircraftDestroyed(victimId: number, killerId: number | null, position: Vector3): void {
    if (this.reported.has(victimId)) return;
    this.reported.add(victimId);
    const victim = this.world.getEntity(victimId);
    if (!victim || victim.kind !== 'aircraft') return;
    const player = this.world.player;
    const credit = killerId ?? victim.damage.lastAttackerId;
    const killer = credit !== null ? this.world.getEntity(credit) : undefined;

    if (player && victim.side === player.side && victim.id !== player.id && victim.flightId === player.flightId) {
      this.radio(victim.callsign, `${victim.callsign} is going down!`);
    }
    if (!killer || killer.kind !== 'aircraft' || killer.side === victim.side) return;
    if (player && killer.flightId === player.flightId) this.flightKills++;

    if (player && killer.id === player.id) {
      const shooters = this.attackers.get(victimId) ?? new Set<number>();
      const shared = [...shooters].some((sid) => {
        const s = this.world.getEntity(sid);
        return sid !== player.id && s?.kind === 'aircraft' && s.side === player.side;
      });
      this.claims.push({
        time: this.world.time,
        victimAircraftId: victim.spec.id,
        victimName: victim.aceId ? `${victim.callsign} (${victim.spec.name})` : victim.spec.name,
        victimAceId: victim.aceId,
        victimSide: victim.side,
        x: position.x,
        z: position.z,
        witnessed: this.isWitnessed(position),
        shared,
      });
      const mate = this.nearestFlightMate();
      this.radio(mate ?? 'Wingman', victim.aceId ? `You got ${victim.callsign}! Magnificent!` : 'Good shooting! He\'s going down!');
    } else if (player && killer.flightId === player.flightId) {
      this.wingmanKills.set(killer.callsign, (this.wingmanKills.get(killer.callsign) ?? 0) + 1);
      this.radio(killer.callsign, `${killer.callsign}: got one!`);
    }
  }

  private onBalloonDestroyed(balloonId: number, killerId: number | null, position: Vector3): void {
    const player = this.world.player;
    const b = this.world.getEntity(balloonId);
    if (!player || !b || b.kind !== 'balloon' || killerId !== player.id || b.side === player.side) return;
    this.claims.push({
      time: this.world.time,
      victimAircraftId: 'balloon',
      victimName: 'Observation balloon',
      victimSide: b.side,
      x: position.x,
      z: position.z,
      witnessed: this.isWitnessed(position),
      shared: false,
    });
    this.radio('', 'The balloon is burning!');
  }

  private isWitnessed(pos: Vector3): boolean {
    const player = this.world.player;
    if (!player) return false;
    if (this.world.sideOfFrontAt(pos.x, pos.z) === player.side) return true;
    return this.world.aircraft.some(
      (a) => a.id !== player.id && a.side === player.side && a.outcome === null && a.state.position.distanceTo(pos) <= WITNESS_RANGE_M,
    );
  }

  private nearestFlightMate(): string | null {
    const p = this.world.player;
    if (!p) return null;
    const mates = this.world.aircraft.filter((a) => a.flightId === p.flightId && a.id !== p.id && a.outcome === null);
    return mates[0]?.callsign ?? null;
  }

  /** Nearest live enemy aircraft distance to the player (Infinity if none). */
  nearestEnemyDistance(): number {
    const p = this.world.player;
    if (!p) return Infinity;
    let best = Infinity;
    for (const a of this.world.aircraft) {
      if (a.side === p.side || a.outcome !== null) continue;
      best = Math.min(best, a.state.position.distanceTo(p.state.position));
    }
    return best;
  }

  canEndFlight(): { ok: boolean; reason?: string } {
    const p = this.world.player;
    if (!p) return { ok: true };
    if (p.outcome !== null) return { ok: true };
    if (this.nearestEnemyDistance() < END_FLIGHT_SAFE_RANGE_M) return { ok: false, reason: 'Enemy aircraft are too close to end the flight.' };
    if (this.world.sideOfFrontAt(p.state.position.x, p.state.position.z) !== p.side)
      return { ok: false, reason: 'You are over enemy lines. Cross back to our side first.' };
    return { ok: true };
  }

  requestEndFlight(): boolean {
    const r = this.canEndFlight();
    if (!r.ok) {
      this.radio('', r.reason!);
      return false;
    }
    this.endedByPlayer = true;
    this.ended = true;
    return true;
  }

  /** Quit immediately regardless of danger (pause menu "Abandon mission"). */
  abort(): void {
    this.aborted = true;
    this.ended = true;
  }

  /** Called every sim tick (or at least every frame). */
  update(dt: number): void {
    if (this.ended) return;
    const w = this.world;
    const player = w.player;

    // Outcome transitions not already reported via events.
    for (const ac of w.aircraft) {
      const prev = this.seenOutcome.get(ac.id) ?? null;
      if (ac.outcome !== prev) {
        this.seenOutcome.set(ac.id, ac.outcome);
        if (ac.outcome && isLost(ac) && !this.reported.has(ac.id)) {
          this.bus.emit({
            type: 'aircraft-destroyed',
            victimId: ac.id,
            killerId: ac.damage.lastAttackerId,
            outcome: ac.outcome,
            position: ac.state.position.clone(),
          });
        }
      }
    }

    if (player) {
      if (player.outcome === null) this.lastPlayerSpeed = player.state.velocity.length();
      // Enemy sighted calls.
      if (player.outcome === null) {
        for (const a of w.aircraft) {
          if (a.side === player.side || a.outcome !== null || this.sightedFlights.has(a.flightId)) continue;
          if (a.state.position.distanceTo(player.state.position) < ENEMY_SIGHTED_RANGE_M) {
            this.sightedFlights.add(a.flightId);
            const { clock, elevation } = clockPosition(player, a.state.position);
            const n = w.aircraft.filter((x) => x.flightId === a.flightId && x.outcome === null).length;
            const what = a.spec.role === 'fighter' ? (n > 1 ? `${n} scouts` : 'a scout') : n > 1 ? `${n} two-seaters` : 'a two-seater';
            this.radio(this.nearestFlightMate() ?? 'Observer', `Enemy aircraft! ${what}, ${clock} o'clock ${elevation}.`);
          }
        }
      }
    }

    // Objectives that can complete (or become impossible) during flight.
    const progress = this.progress();
    for (const obj of w.mission.objectives) {
      if (this.completedObjectives.has(obj.id) || this.failedObjectives.has(obj.id)) continue;
      if (obj.kind === 'patrol-area' && player && player.outcome === null) {
        if (distanceToPatrolLine(obj, w, player.state.position) <= PATROL_STATION_RADIUS_M) this.stationTime.set(obj.id, (this.stationTime.get(obj.id) ?? 0) + dt);
      }
      if (obj.kind === 'protect-flight') {
        for (const fid of obj.targetIds) {
          if (this.crossedLines.has(fid)) continue;
          if ((w.flightMembers.get(fid) ?? []).some((a) => a.outcome === null && w.aircraft.includes(a) && w.sideOfFrontAt(a.state.position.x, a.state.position.z) !== a.side)) this.crossedLines.add(fid);
        }
      }
      if (objectiveFailed(obj, w)) {
        this.failedObjectives.add(obj.id);
        this.bus.emit({ type: 'objective-failed', objectiveId: obj.id });
        this.radio('', `Objective failed: ${obj.description}`);
      } else if (
        (!isDeferredObjective(obj) && evaluateObjective(obj, w, false, undefined, progress)) ||
        (obj.kind === 'protect-flight' && this.chargesHome(obj))
      ) {
        this.completedObjectives.add(obj.id);
        this.bus.emit({ type: 'objective-complete', objectiveId: obj.id });
        this.radio('', `Objective complete: ${obj.description}`);
      }
    }
    this.checkSettled();

    // End conditions.
    if (player && player.outcome !== null && this.endCountdown === null) {
      const landed = player.outcome === 'landed-friendly' || player.outcome === 'landed-enemy' || player.outcome === 'disengaged';
      this.endCountdown = landed ? this.landedEndDelay : this.crashEndDelay;
      if (player.outcome === 'landed-friendly') this.radio('', 'Landed safely.');
      else if (player.outcome === 'landed-enemy') this.radio('', 'You have landed behind enemy lines...');
    }
    if (this.endCountdown !== null) {
      this.endCountdown -= dt;
      if (this.endCountdown <= 0) this.ended = true;
    }
  }

  progress(): ObjectiveProgress {
    return { stationTime: this.stationTime, engaged: this.flightHits >= ENGAGED_HITS || this.flightKills > 0 };
  }

  /** Escort charges have been out over the lines and every survivor is back over ours (or down safely). */
  private chargesHome(o: MissionObjective): boolean {
    if (!o.targetIds.every((fid) => this.crossedLines.has(fid))) return false;
    let alive = 0;
    for (const fid of o.targetIds) {
      for (const a of this.world.flightMembers.get(fid) ?? []) {
        if (isLost(a)) continue;
        alive++;
        if (a.outcome === 'landed-friendly' || a.outcome === 'disengaged') continue;
        if (this.world.sideOfFrontAt(a.state.position.x, a.state.position.z) !== a.side) return false;
      }
    }
    return alive >= o.count;
  }

  /**
   * Once every primary objective is decided, tell the player; when the flight's job was tied to
   * other aircraft or balloons (escort, intercept, balloon defence) and no enemy is near, send
   * the flight home.
   */
  private checkSettled(): void {
    const primary = this.world.mission.objectives.filter((o) => o.primary);
    if (!primary.length) return;
    const player = this.world.player;
    if (!player || player.outcome !== null) return;
    if (!this.settled) {
      if (!primary.every((o) => this.completedObjectives.has(o.id) || this.failedObjectives.has(o.id))) return;
      this.settled = true;
      const failed = primary.some((o) => this.failedObjectives.has(o.id));
      this.radio('', failed ? 'The mission has failed. Return to base.' : 'All objectives complete. Return to base.');
    }
    if (this.recalled || !primary.some((o) => RECALL_KINDS.has(o.kind))) return;
    if (this.nearestEnemyDistance() < RECALL_SAFE_RANGE_M) return;
    this.recalled = true;
    this.onRecall?.();
  }

  playerFate(): PilotFate {
    const p = this.world.player;
    if (!p) return 'returned';
    const d = p.damage;
    if (d.pilotKilled || p.outcome === 'pilot-killed') return 'killed';
    const pos = p.state.position;
    const friendlyGround = this.world.sideOfFrontAt(pos.x, pos.z) === p.side;
    const wounded = d.pilotWounded;
    switch (p.outcome) {
      case null:
        if (this.aborted) {
          // Abandoned mid-flight: over enemy ground he comes down a prisoner; over our own
          // lines he puts down wherever he can - not a safe return to the squadron.
          if (!friendlyGround) return 'captured';
          return wounded ? 'wounded' : 'landed-elsewhere';
        }
        return wounded ? 'wounded' : 'returned';
      case 'landed-friendly': {
        if (wounded) return 'wounded';
        const home = getAerodrome(this.world.mission.homeAerodromeId);
        if (home && Math.hypot(pos.x - home.x, pos.z - home.z) <= HOME_RADIUS_M) return 'returned';
        return 'landed-elsewhere';
      }
      case 'landed-enemy':
        return 'captured';
      case 'disengaged':
        return wounded ? 'wounded' : 'returned';
      case 'ditched':
        return friendlyGround ? 'wounded' : 'captured';
      case 'crashed':
      case 'shot-down':
      case 'collided':
        if (d.onFire || d.structuralFailure || p.outcome === 'collided' || this.lastPlayerSpeed > FATAL_IMPACT_SPEED) return 'killed';
        return friendlyGround ? 'wounded' : 'captured';
    }
  }

  buildResult(): MissionResult {
    const w = this.world;
    const player = w.player;
    const fate = player ? this.playerFate() : undefined;
    const progress = this.progress();
    const objectives = w.mission.objectives.map((o) => ({
      id: o.id,
      completed:
        this.completedObjectives.has(o.id) ||
        (!this.failedObjectives.has(o.id) &&
          // An escort only counts once its charges have been out over the lines.
          (o.kind !== 'protect-flight' || o.targetIds.every((fid) => this.crossedLines.has(fid))) &&
          evaluateObjective(o, w, true, fate, progress)),
    }));
    const primary = w.mission.objectives.filter((o) => o.primary);
    const missionSuccess = !this.aborted && primary.every((o) => objectives.find((x) => x.id === o.id)!.completed);
    const all = w.allAircraft();
    const friendlyLosses = player
      ? all
          .filter((a) => a.flightId === player.flightId && a.id !== player.id && isLost(a))
          .map((a) => ({ name: a.callsign, aceId: a.aceId, fate: lossFate(a, w) }))
      : [];
    const enemyLosses = player ? all.filter((a) => a.side !== player.side && isLost(a)).length : 0;
    return {
      missionId: w.mission.id,
      playerFate: this.playerFate(),
      playerOutcome: player?.outcome ?? 'in-flight',
      endedByPlayer: this.endedByPlayer,
      claims: [...this.claims],
      objectives,
      missionSuccess,
      friendlyLosses,
      enemyLosses,
      flightTimeS: w.time,
      roundsFired: this.roundsFired,
      hits: this.hits,
      wingmanClaims: [...this.wingmanKills].map(([pilotName, count]) => ({ pilotName, count })),
      aborted: this.aborted || undefined,
      acesDown: all
        .filter((a) => a.aceId && a !== player && isLost(a))
        .map((a) => ({ aceId: a.aceId!, side: a.side, fate: lossFate(a, w) })),
    };
  }
}

function lossFate(a: AircraftEntity, w: SessionWorld): PilotFate {
  if (a.damage.pilotKilled || a.damage.onFire || a.damage.structuralFailure || a.outcome === 'collided') return 'killed';
  const pos = a.state.position;
  return w.sideOfFrontAt(pos.x, pos.z) === a.side ? 'wounded' : 'captured';
}

/** Objectives only decidable when the mission ends. */
export function isDeferredObjective(o: MissionObjective): boolean {
  return o.kind === 'protect-flight' || o.kind === 'protect-balloons' || o.kind === 'survive';
}

/**
 * Resolve a waypoint reference: the campaign convention "<flightId>:<waypointIndex>"
 * (docs/campaign.md), or a bare index / waypoint label on the player's own flight.
 */
export function resolveWaypointRef(key: string, w: SessionWorld): { x: number; z: number } | undefined {
  const p = w.player;
  const sep = key.lastIndexOf(':');
  const flight = w.getFlight(sep > 0 ? key.slice(0, sep) : (p?.flightId ?? ''));
  if (!flight) return undefined;
  const ref = sep > 0 ? key.slice(sep + 1) : key;
  const idx = ref !== '' && Number.isFinite(Number(ref)) ? Number(ref) : flight.waypoints.findIndex((wp) => wp.label === ref);
  return flight.waypoints[idx];
}

/** Horizontal distance from `pos` to a patrol-area objective's line (or point). Infinity if unresolvable. */
export function distanceToPatrolLine(o: MissionObjective, w: SessionWorld, pos: Vector3): number {
  const pts = o.targetIds.map((k) => resolveWaypointRef(k, w)).filter((p): p is { x: number; z: number } => !!p);
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(pos.x - pts[0].x, pos.z - pts[0].z);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / len2)) : 0;
    best = Math.min(best, Math.hypot(pos.x - (a.x + abx * t), pos.z - (a.z + abz * t)));
  }
  return best;
}

/** An enemy target aircraft that got clean away: landed, gone, or far off over its own lines. */
function hasEscaped(a: AircraftEntity, w: SessionWorld): boolean {
  if (a.outcome === 'landed-friendly' || a.outcome === 'disengaged') return true;
  if (a.outcome !== null || !w.aircraft.includes(a)) return false; // lost, or not yet spawned
  const p = w.player;
  if (!p) return false;
  const pos = a.state.position;
  return w.sideOfFrontAt(pos.x, pos.z) === a.side && pos.distanceTo(p.state.position) > ESCAPE_RANGE_M;
}

/** True once an objective can no longer be achieved. */
export function objectiveFailed(o: MissionObjective, w: SessionWorld): boolean {
  switch (o.kind) {
    case 'protect-flight': {
      let alive = 0;
      for (const fid of o.targetIds) for (const a of w.flightMembers.get(fid) ?? []) if (!isLost(a)) alive++;
      return alive < o.count;
    }
    case 'protect-balloons': {
      let alive = 0;
      for (const mid of o.targetIds) {
        const e = w.getEntity(w.missionIdToEntity.get(mid) ?? -1);
        if (e?.kind === 'balloon' && !e.destroyed) alive++;
      }
      return alive < o.count;
    }
    case 'destroy-aircraft': {
      let lost = 0;
      let open = 0;
      for (const fid of o.targetIds) {
        for (const a of w.flightMembers.get(fid) ?? []) {
          if (isLost(a)) lost++;
          else if (!hasEscaped(a, w)) open++;
        }
      }
      return lost + open < o.count;
    }
    default:
      return false;
  }
}

export function evaluateObjective(
  o: MissionObjective,
  w: SessionWorld,
  final: boolean,
  playerFate?: PilotFate,
  progress?: ObjectiveProgress,
): boolean {
  switch (o.kind) {
    case 'patrol-area':
      return (progress?.stationTime.get(o.id) ?? 0) >= o.count || !!progress?.engaged;
    case 'destroy-aircraft': {
      let n = 0;
      for (const fid of o.targetIds) for (const a of w.flightMembers.get(fid) ?? []) if (isLost(a)) n++;
      return n >= o.count;
    }
    case 'protect-flight': {
      if (!final) return false;
      let alive = 0;
      for (const fid of o.targetIds) for (const a of w.flightMembers.get(fid) ?? []) if (!isLost(a)) alive++;
      return alive >= o.count;
    }
    case 'destroy-balloons':
    case 'protect-balloons': {
      let destroyed = 0;
      let alive = 0;
      for (const mid of o.targetIds) {
        const e = w.getEntity(w.missionIdToEntity.get(mid) ?? -1);
        if (e?.kind !== 'balloon') continue;
        if (e.destroyed) destroyed++;
        else alive++;
      }
      if (o.kind === 'destroy-balloons') return destroyed >= o.count;
      return final && alive >= o.count;
    }
    case 'destroy-ground': {
      let n = 0;
      for (const mid of o.targetIds) {
        const e = w.getEntity(w.missionIdToEntity.get(mid) ?? -1);
        if (e?.kind === 'ground' && e.destroyed) n++;
      }
      return n >= o.count;
    }
    case 'reach-waypoint': {
      const p = w.player;
      if (!p) return false;
      const wp = resolveWaypointRef(o.targetIds[0] ?? '', w);
      if (!wp) return false;
      return Math.hypot(p.state.position.x - wp.x, p.state.position.z - wp.z) < 1500;
    }
    case 'survive':
      return final && playerFate !== undefined && playerFate !== 'killed' && playerFate !== 'captured';
  }
}
