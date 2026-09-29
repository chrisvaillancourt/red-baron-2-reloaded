/**
 * The player's gunnery, recorded the same way for a human (the flight recorder) and for the
 * autoplayer, so the autoplayer's human-like pilot (src/ai/humanAim.ts) can be fitted to real
 * flights (docs/ai.md "Human-like pursuer"):
 *
 * - rounds and hits by who worked the gun: the player's station (`stationInputs.station`,
 *   the pilot's by default) apart from the AI crew's (a two-seater's observer while the
 *   player flies, the pilot's fixed guns while the player works the rear gun);
 * - while the player's fixed guns are firing, with an enemy inside 400 m and 30 degrees of the
 *   gun line, a histogram of the angle from the gun line to that enemy's true lead
 *   (drag-corrected lead on its velocity and turn);
 * - each time an enemy inside 400 m comes within 10 degrees of the gun line's lead, the
 *   time to the player's first fixed-gun shot;
 * - with the player's guns firing, a histogram of range to the target nearest the gun line
 *   (aircraft, balloon or ground target), for how far out he opens fire.
 *
 * Headless: feed it the bus events (`onEvent`) and call `afterStep()` after every sim step.
 */
import { Vector3 } from 'three';
import { leadSolution, type LeadSolution } from '../ai/gunnery';
import { traitsFor } from '../ai/traits';
import type { AimTelemetry, AircraftEntity, GameEvent } from '../core/types';
import type { WorldQuery } from '../core/interfaces';
import { stationForGun } from '../data/crew';

/** Sample every this many mission seconds. */
const SAMPLE_S = 1 / 30;
const RANGE_M = 400;
const CONE_RAD = (10 * Math.PI) / 180;
/** The cone entry ends once the lead has been outside it this long, s. */
const CONE_EXIT_S = 0.5;
const BUCKETS = 21;
/** Range buckets: 50 m wide to 1,000 m, then 1,000+, then no target in the cone. */
const RANGE_BUCKET_M = 50;
const RANGE_BUCKETS = 22;
const RANGE_CONE_RAD = (30 * Math.PI) / 180;
const MAX_ENTRIES = 200;
/** A gun counts as firing for this long after its last round, s (longer than its round interval). */
const FIRING_S = 0.2;

const _f = new Vector3();
const _acc = new Vector3();
const _rel = new Vector3();

export class AimTracker {
  private readonly t: AimTelemetry = {
    playerRoundsFired: 0,
    playerHits: 0,
    crewRoundsFired: 0,
    crewHits: 0,
    triggerErrorDeg: new Array<number>(BUCKETS).fill(0),
    triggerRangeM: new Array<number>(RANGE_BUCKETS).fill(0),
    coneToShotS: [],
    coneNoShot: 0,
  };
  private readonly mv: number;
  private nextSample = 0;
  private lastSample = -1;
  private readonly prevVel = new Map<number, Vector3>();
  private readonly lead: LeadSolution = { dir: new Vector3(), tof: 0, point: new Vector3() };
  /** Current cone entry: when it began, when the lead was last inside, and whether a shot came. */
  private cone: { since: number; lastIn: number; shot: boolean } | null = null;
  /** A fixed gun the player works fired since the last sample. */
  private firedFixed = false;
  /** When a gun the player works, and a fixed one, last fired. */
  private lastShot = -Infinity;
  private lastFixedShot = -Infinity;

  constructor(
    private readonly world: WorldQuery,
    private readonly player: AircraftEntity | null,
  ) {
    this.mv = player ? traitsFor(player.spec).fixedMuzzleVelocity || 800 : 800;
  }

  onEvent(e: GameEvent): void {
    const p = this.player;
    if (!p) return;
    if (e.type === 'gun-fired' && e.shooterId === p.id) {
      const m = e.mountIndex ?? 0;
      if (!this.playerWorks(p, m)) this.t.crewRoundsFired++;
      else {
        this.t.playerRoundsFired++;
        this.lastShot = this.world.time;
        if (p.spec.guns[m]?.mount !== 'flexible') {
          this.firedFixed = true;
          this.lastFixedShot = this.world.time;
        }
      }
    }
    if (e.type === 'bullet-hit' && e.shooterId === p.id) {
      if (this.playerWorks(p, e.mountIndex ?? 0)) this.t.playerHits++;
      else this.t.crewHits++;
    }
  }

  /** Is gun `mountIndex` worked from the station the player is at (the pilot's by default)? */
  private playerWorks(p: AircraftEntity, mountIndex: number): boolean {
    return (stationForGun(p.spec, mountIndex)?.id ?? 'pilot') === (p.stationInputs?.station ?? 'pilot');
  }

  afterStep(): void {
    const p = this.player;
    const now = this.world.time;
    if (!p || p.outcome !== null || now < this.nextSample) return;
    this.nextSample = now + SAMPLE_S;
    const dt = this.lastSample < 0 ? SAMPLE_S : now - this.lastSample;
    this.lastSample = now;
    const s = p.state;
    const f = _f.set(0, 0, -1).applyQuaternion(s.orientation);
    // The enemy whose true lead is nearest the gun line, inside 400 m and 30 degrees of it.
    let best = Infinity;
    for (const e of this.world.aircraft) {
      if (e.side === p.side || e.outcome !== null) continue;
      const prev = this.prevVel.get(e.id);
      _acc.set(0, 0, 0);
      if (prev && dt > 0) _acc.copy(e.state.velocity).sub(prev).divideScalar(dt);
      if (prev) prev.copy(e.state.velocity);
      else this.prevVel.set(e.id, e.state.velocity.clone());
      const rel = _rel.copy(e.state.position).sub(s.position);
      if (rel.length() > RANGE_M || f.angleTo(rel) > RANGE_CONE_RAD) continue;
      leadSolution(s.position, s.velocity, e.state.position, e.state.velocity, _acc, this.mv, 1, this.lead);
      best = Math.min(best, f.angleTo(this.lead.dir));
    }
    if (best < Infinity && now - this.lastFixedShot < FIRING_S) {
      const deg = (best * 180) / Math.PI;
      this.t.triggerErrorDeg[Math.min(BUCKETS - 1, Math.floor(deg))] += dt;
    }
    if (now - this.lastShot < FIRING_S) {
      const r = this.rangeInCone(p, f);
      this.t.triggerRangeM[r === null ? RANGE_BUCKETS - 1 : Math.min(RANGE_BUCKETS - 2, Math.floor(r / RANGE_BUCKET_M))] += dt;
    }
    // Cone entries and the time to the first shot.
    const fired = this.firedFixed;
    this.firedFixed = false;
    if (best < CONE_RAD) {
      if (!this.cone) this.cone = { since: now, lastIn: now, shot: false };
      this.cone.lastIn = now;
    }
    const c = this.cone;
    if (c && !c.shot && fired) {
      c.shot = true;
      if (this.t.coneToShotS.length < MAX_ENTRIES) this.t.coneToShotS.push(Math.round((now - c.since) * 100) / 100);
    }
    if (c && now - c.lastIn > CONE_EXIT_S) {
      if (!c.shot) this.t.coneNoShot++;
      this.cone = null;
    }
  }

  /** Range to the target nearest the gun line within RANGE_CONE_RAD, m (null: none). */
  private rangeInCone(p: AircraftEntity, f: Vector3): number | null {
    let bestAng = RANGE_CONE_RAD;
    let range: number | null = null;
    const consider = (pos: Vector3) => {
      const rel = _rel.copy(pos).sub(p.state.position);
      const ang = f.angleTo(rel);
      if (ang < bestAng) {
        bestAng = ang;
        range = rel.length();
      }
    };
    for (const e of this.world.aircraft) if (e.side !== p.side && e.outcome === null) consider(e.state.position);
    for (const b of this.world.balloons) if (b.side !== p.side && !b.destroyed) consider(b.position);
    for (const g of this.world.groundTargets) if (g.side !== p.side && !g.destroyed) consider(g.position);
    return range;
  }

  telemetry(): AimTelemetry {
    return {
      ...this.t,
      triggerErrorDeg: this.t.triggerErrorDeg.map((x) => Math.round(x * 100) / 100),
      triggerRangeM: this.t.triggerRangeM.map((x) => Math.round(x * 100) / 100),
      coneToShotS: [...this.t.coneToShotS],
    };
  }
}
