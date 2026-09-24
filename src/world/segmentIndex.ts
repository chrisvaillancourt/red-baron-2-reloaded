/**
 * Bucketed polyline index for fast nearest-segment queries in the XZ plane.
 * Used for front lines, rivers, coast and ridge lines.
 *
 * Signed queries use angle-weighted pseudo-normals at vertices so the sign is
 * correct even at sharp corners (salients) — see signedDistance().
 */

export interface Pt {
  x: number;
  z: number;
}

export interface NearestHit {
  /** Unsigned distance to the nearest point, m. */
  distance: number;
  /** Polyline (group) index the nearest segment belongs to. */
  line: number;
  /** Segment index within that polyline. */
  segment: number;
  /** Parameter along the segment 0..1. */
  t: number;
  /** Arc length from the polyline start to the nearest point, m. */
  along: number;
  /** +1 if the point is to the right of travel direction, -1 to the left. */
  side: number;
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  line: number;
  index: number;
  len: number;
  startAlong: number;
  // unit right-normal of this segment (travel direction rotated -90°)
  nx: number;
  nz: number;
  // pseudo-normals at endpoints (averaged with neighbours)
  pax: number;
  paz: number;
  pbx: number;
  pbz: number;
}

export class SegmentIndex {
  private readonly segs: Seg[] = [];
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private minCX = Infinity;
  private maxCX = -Infinity;
  private minCZ = Infinity;
  private maxCZ = -Infinity;
  readonly lineLengths: number[] = [];

  constructor(lines: Pt[][], cellSize = 4000) {
    this.cell = cellSize;
    lines.forEach((pts, li) => {
      let along = 0;
      const first = this.segs.length;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        // Right of travel: rotate direction (dx,dz) by -90° in the XZ plane viewed from +Y.
        // With +X east and +Z south, travelling north (dz<0) the right-hand side is east (+x).
        const nx = -dz / len;
        const nz = dx / len;
        this.segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, line: li, index: i, len, startAlong: along, nx, nz, pax: nx, paz: nz, pbx: nx, pbz: nz });
        along += len;
      }
      this.lineLengths[li] = along;
      // Pseudo-normals at shared vertices.
      for (let s = first; s < this.segs.length - 1; s++) {
        const cur = this.segs[s];
        const nxt = this.segs[s + 1];
        if (nxt.line !== cur.line) continue;
        let px = cur.nx + nxt.nx;
        let pz = cur.nz + nxt.nz;
        const pl = Math.hypot(px, pz) || 1;
        px /= pl;
        pz /= pl;
        cur.pbx = px;
        cur.pbz = pz;
        nxt.pax = px;
        nxt.paz = pz;
      }
    });
    this.segs.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.ax, s.bx) / this.cell);
      const x1 = Math.floor(Math.max(s.ax, s.bx) / this.cell);
      const z0 = Math.floor(Math.min(s.az, s.bz) / this.cell);
      const z1 = Math.floor(Math.max(s.az, s.bz) / this.cell);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const k = this.key(cx, cz);
          let b = this.buckets.get(k);
          if (!b) this.buckets.set(k, (b = []));
          b.push(i);
          this.minCX = Math.min(this.minCX, cx);
          this.maxCX = Math.max(this.maxCX, cx);
          this.minCZ = Math.min(this.minCZ, cz);
          this.maxCZ = Math.max(this.maxCZ, cz);
        }
    });
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  get segmentCount(): number {
    return this.segs.length;
  }

  /**
   * Nearest segment to (x, z). Searches rings of buckets outward until no
   * closer segment can exist. `maxDistance` caps the search (returns
   * distance = Infinity when nothing is that close).
   */
  nearest(x: number, z: number, maxDistance = Infinity, out?: NearestHit): NearestHit {
    const hit = out ?? { distance: Infinity, line: -1, segment: -1, t: 0, along: 0, side: 1 };
    hit.distance = Infinity;
    hit.line = -1;
    if (this.segs.length === 0) return hit;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = maxDistance;
    let bestSeg = -1;
    let bestT = 0;
    const seen = new Set<number>();
    // Max ring needed to cover the whole index from this point.
    const maxRing = Math.max(Math.abs(cx - this.minCX), Math.abs(cx - this.maxCX), Math.abs(cz - this.minCZ), Math.abs(cz - this.maxCZ)) + 1;
    for (let r = 0; r <= maxRing; r++) {
      // Any segment in ring r is at least (r - 1) * cell away.
      if ((r - 1) * this.cell > best) break;
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const b = this.buckets.get(this.key(ix, iz));
          if (!b) continue;
          for (const si of b) {
            if (seen.has(si)) continue;
            seen.add(si);
            const s = this.segs[si];
            const abx = s.bx - s.ax;
            const abz = s.bz - s.az;
            let t = ((x - s.ax) * abx + (z - s.az) * abz) / (s.len * s.len);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = s.ax + abx * t - x;
            const pz = s.az + abz * t - z;
            const d = Math.sqrt(px * px + pz * pz);
            if (d < best) {
              best = d;
              bestSeg = si;
              bestT = t;
            }
          }
        }
      }
    }
    if (bestSeg < 0) return hit;
    const s = this.segs[bestSeg];
    hit.distance = best;
    hit.line = s.line;
    hit.segment = s.index;
    hit.t = bestT;
    hit.along = s.startAlong + s.len * bestT;
    const qx = s.ax + (s.bx - s.ax) * bestT;
    const qz = s.az + (s.bz - s.az) * bestT;
    let nx = s.nx;
    let nz = s.nz;
    if (bestT <= 1e-9) {
      nx = s.pax;
      nz = s.paz;
    } else if (bestT >= 1 - 1e-9) {
      nx = s.pbx;
      nz = s.pbz;
    }
    hit.side = (x - qx) * nx + (z - qz) * nz >= 0 ? 1 : -1;
    return hit;
  }

  /** Distance positive on the right-hand side of travel, negative on the left. */
  signedDistance(x: number, z: number, maxDistance = Infinity): number {
    const h = this.nearest(x, z, maxDistance, scratch);
    return h.distance * h.side;
  }
}

const scratch: NearestHit = { distance: 0, line: 0, segment: 0, t: 0, along: 0, side: 1 };

/** Resample a polyline to `n` points evenly spaced by arc length. */
export function resamplePolyline(pts: Pt[], n: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, z: pts[j].z + (pts[j + 1].z - pts[j].z) * t });
  }
  return out;
}

/** Chaikin corner-cutting smoothing (keeps endpoints). */
export function smoothPolyline(pts: Pt[], iterations = 2): Pt[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const q: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      q.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Even-odd point-in-polygon test in XZ. */
export function pointInPolygon(x: number, z: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
