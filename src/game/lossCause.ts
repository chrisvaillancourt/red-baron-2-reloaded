/**
 * What took the player out, for the autoplayer's surveys and the flight report: `collision-<with>`,
 * `enemy-fire(<outcome>)`, `flak/ground(<outcome>)` or `self(<outcome>, <phase>)`. Null while the
 * player is intact or came home.
 *
 * Damage that arrives without a bullet hit is flak or ground fire; whichever of the two hit him
 * last (within 25 s) gets the blame. A shot-up airframe that fails later is the enemy's doing.
 */
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, GameEvent } from '../core/types';

export type LossCauseWorld = Pick<WorldQuery, 'time' | 'getEntity'>;

export class LossCauseTracker {
  private lastBulletHit = -Infinity;
  private lastSplinter = -Infinity;
  private collisionWith: string | null = null;
  private lastDamageSum = 0;
  private wasFailed = false;
  private result: string | null = null;

  /** `phase` names what the player was doing (the autoplayer's AI phase), for `self(...)` losses. */
  constructor(
    private readonly world: LossCauseWorld,
    private readonly player: AircraftEntity | null,
    private readonly phase: () => string = () => '?',
  ) {}

  get cause(): string | null {
    return this.result;
  }

  onEvent(e: GameEvent): void {
    const p = this.player;
    if (!p) return;
    if (e.type === 'bullet-hit' && e.targetId === p.id) this.lastBulletHit = this.world.time;
    if (e.type === 'collision' && (e.aId === p.id || e.bId === p.id) && this.collisionWith === null) {
      const other = this.world.getEntity(e.aId === p.id ? e.bId : e.aId);
      this.collisionWith = !other
        ? 'unknown'
        : other.kind !== 'aircraft'
          ? other.kind
          : other.side !== p.side
            ? 'enemy'
            : other.flightId === p.flightId
              ? 'wingman'
              : 'friendly';
    }
  }

  /** Call after every sim step. */
  step(): void {
    const p = this.player;
    if (!p || this.result !== null) return;
    const t = this.world.time;
    let sum = 0;
    for (const v of Object.values(p.damage.zones)) sum += v;
    const failedNow = p.damage.structuralFailure && !this.wasFailed;
    this.wasFailed = p.damage.structuralFailure;
    if (sum > this.lastDamageSum + 1e-9 && this.lastBulletHit < t - 0.02 && !failedNow) this.lastSplinter = t;
    this.lastDamageSum = sum;
    const o = p.outcome;
    if (o === null || o === 'landed-friendly' || o === 'disengaged') return;
    const recent = (x: number) => t - x < 25;
    this.result =
      o === 'collided'
        ? `collision-${this.collisionWith ?? '?'}`
        : recent(this.lastBulletHit) && (!recent(this.lastSplinter) || this.lastBulletHit >= this.lastSplinter)
          ? `enemy-fire(${o})`
          : recent(this.lastSplinter)
            ? `flak/ground(${o})`
            : `self(${o}, ${this.phase()})`;
  }
}
