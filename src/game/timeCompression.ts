/**
 * When time compression must drop to x1 (docs/game.md "Time compression"):
 * enemy aircraft close, low over enemy ground or near live enemy ground
 * targets / AA, or the player recently under fire (hit, silent trench-fire
 * damage, a near flak burst, an enemy round passing close).
 */
import type { Vector3 } from 'three';
import type { GameEvent, GroundTargetEntity, Side } from '../core/types';

/** Enemy aircraft closer than this block compression (m). */
export const COMPRESSION_SAFE_RANGE = 4000;
/** "Low" for the ground rules: trench small-arms reach, with margin (m AGL). */
const LOW_AGL = 300;
const GROUND_TARGET_RANGE = 2500;
const AA_RANGE = 4000;
/** How long a threat keeps compression off (s). */
const THREAT_HOLD = 8;
const FLAK_NEAR = 200;
const NEAR_MISS = 40;

export type CompressionBlock = 'enemy-air' | 'ground' | 'under-fire' | null;

export interface CompressionContext {
  playerSide: Side;
  position: Vector3;
  agl: number;
  /** Who holds the ground under the player. */
  sideOfGround: Side;
  groundTargets: readonly GroundTargetEntity[];
  nearestEnemyAir: number;
  secondsSinceThreat: number;
}

export function compressionBlock(c: CompressionContext): CompressionBlock {
  if (c.nearestEnemyAir < COMPRESSION_SAFE_RANGE) return 'enemy-air';
  if (c.secondsSinceThreat < THREAT_HOLD) return 'under-fire';
  if (c.agl < LOW_AGL) {
    if (c.sideOfGround !== c.playerSide) return 'ground';
    for (const g of c.groundTargets) {
      if (g.destroyed || g.side === c.playerSide) continue;
      const d = Math.hypot(g.position.x - c.position.x, g.position.z - c.position.z);
      if (d < (g.type === 'aa-gun' ? AA_RANGE : GROUND_TARGET_RANGE)) return 'ground';
    }
  }
  return null;
}

export const COMPRESSION_BLOCK_MESSAGES: Record<Exclude<CompressionBlock, null>, { refused: string; cut: string }> = {
  'enemy-air': { refused: 'Enemy aircraft nearby: time compression unavailable.', cut: 'Enemy aircraft sighted: time compression off.' },
  ground: { refused: 'Low over enemy positions: time compression unavailable.', cut: 'Low over enemy positions: time compression off.' },
  'under-fire': { refused: 'Under fire: time compression unavailable.', cut: 'Under fire: time compression off.' },
};

interface WatchedPlayer {
  id: number;
  side: Side;
  state: { position: Vector3 };
  damage: { zones: Record<string, number> };
}

/** Remembers when the player was last threatened. */
export class ThreatWatch {
  private last = -Infinity;
  private damage = -1;

  /** Per frame: silent damage (trench fire) and enemy rounds passing close. */
  update(player: WatchedPlayer, bullets: readonly { position: Vector3; side: Side }[], time: number): void {
    let sum = 0;
    for (const v of Object.values(player.damage.zones)) sum += v;
    if (this.damage >= 0 && sum > this.damage + 1e-6) this.last = time;
    this.damage = sum;
    const p = player.state.position;
    for (const b of bullets) {
      if (b.side !== player.side && b.position.distanceToSquared(p) < NEAR_MISS * NEAR_MISS) {
        this.last = time;
        break;
      }
    }
  }

  onEvent(e: GameEvent, player: WatchedPlayer, time: number): void {
    if (e.type === 'bullet-hit' && e.targetId === player.id) this.last = time;
    else if ((e.type === 'pilot-hit' || e.type === 'fire-started') && e.aircraftId === player.id) this.last = time;
    else if (e.type === 'flak-burst' && e.position.distanceTo(player.state.position) < FLAK_NEAR) this.last = time;
  }

  secondsSince(time: number): number {
    return time - this.last;
  }
}
