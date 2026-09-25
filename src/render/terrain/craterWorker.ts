import { craterGridsForDate } from '../../world/frontline';

// Builds the crater/freshness history grids for a date off the main thread.
// Typed minimally to avoid pulling the WebWorker lib (conflicts with DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ date: string }>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const g = craterGridsForDate(e.data.date);
  if (!g) {
    ctx.postMessage({ date: e.data.date, grid: null, fresh: null }, []);
    return;
  }
  // Copies: the worker keeps nothing it needs, but transferring the cached
  // arrays would detach them if another request for the date arrives.
  const grid = g[0].slice();
  const fresh = g[1].slice();
  ctx.postMessage({ date: e.data.date, grid, fresh }, [grid.buffer, fresh.buffer]);
};
