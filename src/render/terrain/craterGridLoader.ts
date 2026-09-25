/**
 * Keeps the main thread's crater-history grids (src/world/frontline) built
 * off-thread. Main-thread consumers (effects' landUseAt on bullet impacts)
 * would otherwise build a date's grid synchronously (~0.5 s) the first time
 * they query it, mid-combat. The renderer requests the grid for every date it
 * is given and `whenReady()` waits for it behind the loading screen.
 */
import { hasCraterGrids, installCraterGrids } from '../../world/frontline';

interface CraterReply {
  date: string;
  grid: Float32Array | null;
  fresh: Float32Array | null;
}

export class CraterGridLoader {
  private worker: Worker | null = null;
  private readonly waiting = new Map<string, (() => void)[]>();
  private current: Promise<void> = Promise.resolve();

  /** Request `date`'s grids; resolves when queries on the main thread are cheap. */
  ensure(date: string): Promise<void> {
    if (hasCraterGrids(date)) return (this.current = Promise.resolve());
    if (typeof Worker === 'undefined') return (this.current = Promise.resolve()); // Node: built lazily on first query
    const p = new Promise<void>((resolve) => {
      const list = this.waiting.get(date);
      if (list) {
        list.push(resolve);
        return;
      }
      this.waiting.set(date, [resolve]);
      this.getWorker().postMessage({ date });
    });
    this.current = p;
    return p;
  }

  /** The most recent request (for whenReady). */
  whenReady(): Promise<void> {
    return this.current;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const list of this.waiting.values()) list.forEach((r) => r());
    this.waiting.clear();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./craterWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<CraterReply>) => {
      const { date, grid, fresh } = e.data;
      if (grid && fresh) installCraterGrids(date, grid, fresh);
      this.waiting.get(date)?.forEach((r) => r());
      this.waiting.delete(date);
    };
    w.onerror = () => {
      // Fall back to lazy main-thread builds; never block loading.
      for (const list of this.waiting.values()) list.forEach((r) => r());
      this.waiting.clear();
    };
    this.worker = w;
    return w;
  }
}
