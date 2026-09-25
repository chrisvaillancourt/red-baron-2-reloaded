/**
 * Map label placement: pick the first candidate slot around an anchor that
 * stays on the sheet and clears everything already placed (other labels and
 * waypoint circles). Falls back to the least-overlapping slot.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * @param ax,ay anchor centre; r anchor radius; w,h label size; gap spacing.
 * Candidate order: right, left, above-right, below-right, above-left, below-left.
 */
export function placeLabel(ax: number, ay: number, r: number, w: number, h: number, gap: number, taken: readonly Rect[], bounds: Rect): Rect {
  const cands: Rect[] = [
    { x: ax + r + gap, y: ay - h / 2, w, h },
    { x: ax - r - gap - w, y: ay - h / 2, w, h },
    { x: ax + r * 0.4, y: ay - r - gap - h, w, h },
    { x: ax + r * 0.4, y: ay + r + gap, w, h },
    { x: ax - r * 0.4 - w, y: ay - r - gap - h, w, h },
    { x: ax - r * 0.4 - w, y: ay + r + gap, w, h },
  ];
  let best = cands[0];
  let bestCost = Infinity;
  for (const c of cands) {
    const off =
      Math.max(0, bounds.x - c.x) + Math.max(0, c.x + c.w - (bounds.x + bounds.w)) + Math.max(0, bounds.y - c.y) + Math.max(0, c.y + c.h - (bounds.y + bounds.h));
    let cost = off * c.h * 4;
    for (const t of taken) cost += overlap(c, t);
    if (cost === 0) return c;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}
