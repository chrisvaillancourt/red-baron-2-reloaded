/**
 * Flight recorder: the statistics a flight report needs that the MissionResult doesn't carry
 * (docs/game.md "Flight report"). Hits taken, what took the player out, time in combat, each
 * enemy's first firing pass (from above, out of the sun, seen or unseen), the player's gunnery
 * (aimStats.ts), time compression and frame rate. Headless (no DOM), so the autoplayer and tests can record a flight too.
 *
 * Feed it: `afterStep()` after every SimCore step, `frame()` once per rendered frame (browser
 * only), and `telemetry()` when the flight ends. It subscribes to the core's event bus itself.
 */
import type { AIController } from '../core/interfaces';
import type { AircraftEntity, EnemyEntryTelemetry, FlightTelemetry } from '../core/types';
import { EntryTracker, type PassRecord } from '../ai/entryStats';
import { AimTracker } from './aimStats';
import { LossCauseTracker } from './lossCause';
import type { SimCore } from './simCore';

/** Seconds between geometry and combat samples (mission time). */
const SAMPLE_S = 0.1;
/** Frame-time histogram: 0.5 ms buckets up to 250 ms (4 fps). */
const BUCKET_MS = 0.5;
const BUCKETS = 500;

export interface FlightRecorderOptions {
  /** Did the human player know about this enemy (the HUD's PlayerAwareness)? */
  playerKnows?(enemyId: number): boolean;
}

export class FlightRecorder {
  private readonly loss: LossCauseTracker;
  private readonly entries: EntryTracker;
  private readonly aim: AimTracker;
  private readonly firstPass = new Map<number, PassRecord>();
  private hitsTaken = 0;
  private nextSample = 0;
  private compressedRealS = 0;
  private compressedSimS = 0;
  private maxScale = 1;
  private readonly frameHist = new Uint32Array(BUCKETS + 1);
  private frames = 0;
  private readonly unsub: () => void;

  constructor(
    private readonly core: SimCore,
    opts: FlightRecorderOptions = {},
  ) {
    const world = core.world;
    const player = world.player;
    this.loss = new LossCauseTracker(world, player, () => (player ? phaseOf(core.ai.get(player.id)) : '?'));
    this.entries = new EntryTracker(world, (id) => core.ai.get(id), (a) => String(a.id), undefined, {
      // Combat time is reported for the player only; skip the per-aircraft turn bookkeeping.
      combatOf: (a) => a === player,
      seenBy: (target, shooter) => (player && target.id === player.id && opts.playerKnows ? opts.playerKnows(shooter.id) : undefined),
      onPass: (p) => {
        if (!player || p.shooter.side === player.side || this.firstPass.has(p.shooter.id)) return;
        this.firstPass.set(p.shooter.id, p);
      },
    });
    this.aim = new AimTracker(world, player);
    this.unsub = core.bus.onAny((e) => {
      this.loss.onEvent(e);
      this.aim.onEvent(e);
      if (e.type === 'bullet-hit' && player && e.targetId === player.id) this.hitsTaken++;
      if (e.type === 'gun-fired') {
        const a = world.getEntity(e.shooterId);
        if (a?.kind === 'aircraft') this.entries.onFired(a, e.mountIndex);
      }
    });
  }

  /** After every sim step. */
  afterStep(): void {
    this.loss.step();
    this.aim.afterStep();
    const world = this.core.world;
    if (world.time < this.nextSample) return;
    const dt = SAMPLE_S + (world.time - this.nextSample);
    this.nextSample = world.time + SAMPLE_S;
    // Also accumulates the player's combat time: alive, with an enemy within 1.5 km.
    this.entries.sample(dt);
  }

  /**
   * Once per rendered frame. `dtRaw`: real seconds since the last frame, unclamped (frame rate).
   * `dtStep`: the real seconds the session let the sim advance (clamped to its MAX_FRAME_DT), so
   * a background tab or hitch doesn't inflate the compression totals.
   */
  frame(dtRaw: number, dtStep: number, timeScale: number): void {
    if (dtRaw <= 0) return;
    this.frames++;
    this.frameHist[Math.min(BUCKETS, Math.floor((dtRaw * 1000) / BUCKET_MS))]++;
    if (timeScale > 1) {
      this.compressedRealS += dtStep;
      this.compressedSimS += dtStep * timeScale;
      this.maxScale = Math.max(this.maxScale, timeScale);
    }
  }

  telemetry(): FlightTelemetry {
    this.entries.finish();
    const world = this.core.world;
    const player = world.player;
    const enemies: EnemyEntryTelemetry[] = player
      ? world
          .allAircraft()
          .filter((a) => a.side !== player.side)
          .map((a) => enemyEntry(a, this.firstPass.get(a.id), player))
      : [];
    return {
      hitsTaken: this.hitsTaken,
      lossCause: this.loss.cause,
      combatTimeS: round1(player ? this.entries.get(String(player.id)).combat : 0),
      timeCompression: { realS: round1(this.compressedRealS), simS: round1(this.compressedSimS), maxScale: this.maxScale },
      fps: this.frames ? { p50: this.fpsAt(0.5), p95: this.fpsAt(0.95), frames: this.frames } : null,
      enemies,
      aim: this.aim.telemetry(),
    };
  }

  dispose(): void {
    this.unsub();
  }

  /** Frame rate at the q-th quantile of frame time (bucket midpoint). */
  private fpsAt(q: number): number {
    const want = q * this.frames;
    let seen = 0;
    for (let i = 0; i <= BUCKETS; i++) {
      seen += this.frameHist[i];
      if (seen >= want) return round1(1000 / ((i + 0.5) * BUCKET_MS));
    }
    return 0;
  }
}

function enemyEntry(a: AircraftEntity, p: PassRecord | undefined, player: AircraftEntity): EnemyEntryTelemetry {
  return {
    aircraftId: a.spec.id,
    flightId: a.flightId,
    callsign: a.callsign,
    ...(a.aceId ? { aceId: a.aceId } : {}),
    skill: a.skill,
    outcome: a.outcome ?? 'in-flight',
    firstPass: p
      ? { t: round1(p.time), atPlayer: p.target.id === player.id, heightAdvM: Math.round(p.heightAdvM), above: p.above, upSun: p.upSun, seen: p.seen }
      : null,
  };
}

function phaseOf(c: AIController | undefined): string {
  return (c as { phase?: string } | undefined)?.phase ?? '?';
}

const round1 = (x: number) => Math.round(x * 10) / 10;
