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
    const player = world.player;
    this.unsub.push(
      bus.on('gun-fired', (e) => {
        if (player && e.shooterId === player.id) this.roundsFired++;
      }),
      bus.on('bullet-hit', (e) => {
        if (player && e.shooterId === player.id) this.hits++;
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

    // Objectives that can complete during flight.
    for (const obj of w.mission.objectives) {
      if (this.completedObjectives.has(obj.id)) continue;
      if (isDeferredObjective(obj)) continue;
      if (evaluateObjective(obj, w, false)) {
        this.completedObjectives.add(obj.id);
        this.bus.emit({ type: 'objective-complete', objectiveId: obj.id });
        this.radio('', `Objective complete: ${obj.description}`);
      }
    }

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
    const objectives = w.mission.objectives.map((o) => ({
      id: o.id,
      completed: this.completedObjectives.has(o.id) || evaluateObjective(o, w, true, player ? this.playerFate() : undefined),
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

export function evaluateObjective(o: MissionObjective, w: SessionWorld, final: boolean, playerFate?: PilotFate): boolean {
  switch (o.kind) {
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
      // Campaign convention: "<flightId>:<waypointIndex>" (docs/campaign.md); also accept a
      // bare index or a waypoint label on the player's own flight.
      const key = o.targetIds[0] ?? '';
      const sep = key.lastIndexOf(':');
      const flight = w.getFlight(sep > 0 ? key.slice(0, sep) : p.flightId);
      if (!flight) return false;
      const ref = sep > 0 ? key.slice(sep + 1) : key;
      const idx = ref !== '' && Number.isFinite(Number(ref)) ? Number(ref) : flight.waypoints.findIndex((wp) => wp.label === ref);
      const wp = flight.waypoints[idx];
      if (!wp) return false;
      return Math.hypot(p.state.position.x - wp.x, p.state.position.z - wp.z) < 1500;
    }
    case 'survive':
      return final && playerFate !== undefined && playerFate !== 'killed' && playerFate !== 'captured';
  }
}
