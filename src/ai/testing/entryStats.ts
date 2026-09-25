/**
 * Attack-entry geometry for soaks and tests: for each firing pass (the first round after
 * a 4 s pause), where the shooter came from relative to its target: height advantage,
 * out of the sun, unseen. Also time spent in sustained flat turns (bank > 45°, climb
 * angle within ±10°, lasting more than 5 s) with an enemy within 1.5 km.
 */
import { Vector3 } from 'three';
import type { AircraftEntity } from '../../core/types';
import { bankAngle } from '../../sim/flightModel';

export interface EntryAcc {
  passes: number;
  /** Passes begun at least 100 m above the target. */
  above: number;
  /** Passes begun with the shooter within 15° of the sun as seen from the target. */
  upSun: number;
  /** Passes begun before the target's pilot had the shooter in his contacts (AI targets only). */
  unseen: number;
  aboveOrSun: number;
  heightAdvSum: number;
  /** Seconds in sustained flat turns, and seconds with an enemy within 1.5 km. */
  flatTurn: number;
  combat: number;
}

export const zeroEntry = (): EntryAcc => ({ passes: 0, above: 0, upSun: 0, unseen: 0, aboveOrSun: 0, heightAdvSum: 0, flatTurn: 0, combat: 0 });

interface CtlView {
  targetId?: number | null;
  perception?: { contacts?: Map<number, unknown> };
}

export interface EntryWorld {
  readonly time: number;
  readonly aircraft: readonly AircraftEntity[];
  readonly sunDirection?: Vector3;
}

const PASS_GAP_S = 4;
const SUN_CONE = (15 * Math.PI) / 180;

export class EntryTracker {
  private readonly lastShot = new Map<number, number>();
  private readonly seg = new Map<number, number>();
  /** `acc` may be shared across runs to pool them. */
  constructor(
    private readonly world: EntryWorld,
    private readonly ctl: (id: number) => unknown,
    private readonly key: (a: AircraftEntity) => string,
    private readonly acc = new Map<string, EntryAcc>(),
  ) {}

  get(k: string): EntryAcc {
    let v = this.acc.get(k);
    if (!v) this.acc.set(k, (v = zeroEntry()));
    return v;
  }

  entries(): [string, EntryAcc][] {
    return [...this.acc].sort();
  }

  /** Feed every gun-fired event. */
  onFired(shooter: AircraftEntity): void {
    const t = this.world.time;
    const prev = this.lastShot.get(shooter.id) ?? -1e9;
    this.lastShot.set(shooter.id, t);
    if (t - prev < PASS_GAP_S) return;
    const target = this.targetOf(shooter);
    if (!target) return;
    const g = this.get(this.key(shooter));
    g.passes++;
    const dh = shooter.state.position.y - target.state.position.y;
    g.heightAdvSum += dh;
    const above = dh > 100;
    if (above) g.above++;
    const sun = this.world.sunDirection;
    let upSun = false;
    if (sun && sun.y > 0.05) {
      const los = shooter.state.position.clone().sub(target.state.position);
      upSun = los.angleTo(sun) < SUN_CONE;
    }
    if (upSun) g.upSun++;
    if (above || upSun) g.aboveOrSun++;
    const tc = this.ctl(target.id) as CtlView | undefined;
    if (tc?.perception?.contacts && !tc.perception.contacts.has(shooter.id)) g.unseen++;
  }

  /** Call at a fixed interval dt for flat-turn time. */
  sample(dt: number): void {
    for (const a of this.world.aircraft) {
      if (a.outcome) continue;
      const near = this.world.aircraft.some((e) => e.side !== a.side && !e.outcome && e.state.position.distanceToSquared(a.state.position) < 1500 * 1500);
      const g = this.get(this.key(a));
      if (near) g.combat += dt;
      const v = a.state.velocity;
      const climb = Math.asin(Math.max(-1, Math.min(1, v.y / Math.max(1, v.length()))));
      const flat = near && Math.abs(bankAngle(a.state.orientation)) > Math.PI / 4 && Math.abs(climb) < Math.PI / 18;
      const s = this.seg.get(a.id) ?? 0;
      if (flat) this.seg.set(a.id, s + dt);
      else {
        if (s > 5) g.flatTurn += s;
        this.seg.set(a.id, 0);
      }
    }
  }

  /** Close open flat-turn segments (end of a run). */
  finish(): void {
    for (const a of this.world.aircraft) {
      const s = this.seg.get(a.id) ?? 0;
      if (s > 5) this.get(this.key(a)).flatTurn += s;
      this.seg.set(a.id, 0);
    }
  }

  private targetOf(a: AircraftEntity): AircraftEntity | undefined {
    const c = this.ctl(a.id) as CtlView | undefined;
    const id = c?.targetId;
    const byId = id != null ? this.world.aircraft.find((x) => x.id === id) : undefined;
    if (byId && byId.side !== a.side) return byId;
    // Nearest enemy ahead (e.g. the player's own flying).
    let best: AircraftEntity | undefined;
    let bd = Infinity;
    for (const e of this.world.aircraft) {
      if (e.side === a.side || e.outcome) continue;
      const d = e.state.position.distanceTo(a.state.position);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return bd < 1000 ? best : undefined;
  }
}

/** One-line summary: passes, % from above, % up-sun, % above-or-sun, % unseen, mean dh, flat-turn share. */
export function entryLine(g: EntryAcc): string {
  const p = (x: number) => (g.passes ? `${Math.round((100 * x) / g.passes)}%` : '-');
  return `passes ${g.passes} | above ${p(g.above)} | up-sun ${p(g.upSun)} | above/sun ${p(g.aboveOrSun)} | unseen ${p(g.unseen)} | mean dh ${g.passes ? (g.heightAdvSum / g.passes).toFixed(0) : '-'} m | flat turn ${g.combat ? ((100 * g.flatTurn) / g.combat).toFixed(0) : '-'}% of ${g.combat.toFixed(0)} s`;
}
