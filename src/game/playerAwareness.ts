/**
 * Which enemy aircraft the player could know about, so the HUD's threat triangles
 * and automatic target box don't reveal an enemy hidden in the sun or in cloud
 * (DECISIONS "Perception: sun glare, cloud and memory"). An enemy becomes known
 * when a human could see it (a veteran's 4 km, shortened by sun glare and cloud:
 * src/ai/perception humanSees), when it shoots at the player, or when it hits the
 * player, and stays known for a few seconds after it drops out of sight. Padlock
 * and an explicitly selected target are not filtered: RB2's padlock worked
 * through cloud.
 */
import type { WorldQuery } from '../core/interfaces';
import type { AircraftEntity, GameEvent } from '../core/types';
import { humanSees, isAttacking } from '../ai/perception';

/** Seconds an enemy stays on the HUD after the player loses sight of it. */
export const AWARENESS_MEMORY_S = 8;
const UPDATE_S = 0.2;

export class PlayerAwareness {
  private readonly lastKnown = new Map<number, number>();
  private next = -Infinity;

  /** Throttled to 5 Hz: sight checks cast cloud rays. */
  update(player: AircraftEntity, world: WorldQuery): void {
    const t = world.time;
    if (t < this.next) return;
    this.next = t + UPDATE_S;
    for (const a of world.aircraft) {
      if (a.side === player.side || a.outcome !== null) continue;
      // Tracers and muzzle flashes give a shooter away.
      if (humanSees(player, a, world) || (a.controls.fireGuns && isAttacking(a, player, 900))) this.lastKnown.set(a.id, t);
    }
  }

  onEvent(e: GameEvent, player: AircraftEntity, time: number): void {
    if (e.type === 'bullet-hit' && e.targetId === player.id) this.lastKnown.set(e.shooterId, time);
  }

  knows(id: number, time: number): boolean {
    const t = this.lastKnown.get(id);
    return t !== undefined && time - t <= AWARENESS_MEMORY_S;
  }
}
