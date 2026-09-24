/**
 * Terrain chunk geometry builder. Pure (no three.js) so it runs in a web
 * worker or on the main thread. Produces a regular (N+1)^2 grid plus a skirt
 * ring, with per-vertex land-use attributes for the terrain shader.
 */
import { craterIntensityAt, signedDistanceToFront } from '../../world/frontline';
import { forestDensityAt, townDensityAt } from '../../world/landuse';
import { coastDistance, terrainHeightAt } from '../../world/terrain';

export const CHUNK_SEGMENTS = 32;

export interface ChunkRequest {
  id: number;
  /** Chunk centre, world metres. */
  cx: number;
  cz: number;
  size: number;
  date: string;
}

export interface ChunkData {
  id: number;
  positions: Float32Array; // local to (cx, 0, cz)
  normals: Float32Array;
  land: Float32Array; // forest, town, crater, beach
  front: Float32Array; // signed distance to front (m)
  minY: number;
  maxY: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function vertexCount(n = CHUNK_SEGMENTS): number {
  return (n + 1) * (n + 1) + 4 * (n + 1);
}

/** Shared index buffer for every chunk (grid + skirt). */
export function buildChunkIndices(n = CHUNK_SEGMENTS): Uint16Array | Uint32Array {
  const v = n + 1;
  const grid = v * v;
  const idx: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * v + i;
      const b = a + 1;
      const c = a + v;
      const d = c + 1;
      // Alternate diagonal for a less directional look.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  // Skirts: 4 edges, each (n+1) skirt verts appended in order north, south, west, east.
  const edge = (k: number, e: number) => grid + e * v + k;
  for (let k = 0; k < n; k++) {
    // north edge (j = 0), grid verts k..k+1
    let a = k, b = k + 1, sa = edge(k, 0), sb = edge(k + 1, 0);
    idx.push(a, b, sa, b, sb, sa);
    // south edge (j = n)
    a = n * v + k;
    b = a + 1;
    sa = edge(k, 1);
    sb = edge(k + 1, 1);
    idx.push(a, sa, b, b, sa, sb);
    // west edge (i = 0)
    a = k * v;
    b = (k + 1) * v;
    sa = edge(k, 2);
    sb = edge(k + 1, 2);
    idx.push(a, sa, b, b, sa, sb);
    // east edge (i = n)
    a = k * v + n;
    b = (k + 1) * v + n;
    sa = edge(k, 3);
    sb = edge(k + 1, 3);
    idx.push(a, b, sa, b, sb, sa);
  }
  const total = grid + 4 * v;
  return total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
}

export function buildChunk(req: ChunkRequest, n = CHUNK_SEGMENTS): ChunkData {
  const v = n + 1;
  const step = req.size / n;
  const x0 = req.cx - req.size / 2;
  const z0 = req.cz - req.size / 2;
  // Heights with a 1-sample border for normals.
  const hw = v + 2;
  const heights = new Float32Array(hw * hw);
  for (let j = -1; j <= n + 1; j++)
    for (let i = -1; i <= n + 1; i++) heights[(j + 1) * hw + (i + 1)] = terrainHeightAt(x0 + i * step, z0 + j * step);

  const count = vertexCount(n);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const land = new Float32Array(count * 4);
  const front = new Float32Array(count);
  let minY = Infinity;
  let maxY = -Infinity;
  const detailed = req.size <= 16_384;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const k = j * v + i;
      const wx = x0 + i * step;
      const wz = z0 + j * step;
      const h = heights[(j + 1) * hw + (i + 1)];
      positions[k * 3] = wx - req.cx;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = wz - req.cz;
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
      const hl = heights[(j + 1) * hw + i];
      const hr = heights[(j + 1) * hw + i + 2];
      const hu = heights[j * hw + i + 1];
      const hd = heights[(j + 2) * hw + i + 1];
      let nx = hl - hr;
      let ny = 2 * step;
      let nz = hu - hd;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      const fd = signedDistanceToFront(wx, wz, req.date);
      front[k] = fd;
      const crater = Math.abs(fd) < 40_000 ? craterIntensityAt(wx, wz, req.date) : 0;
      land[k * 4] = forestDensityAt(wx, wz);
      land[k * 4 + 1] = detailed || req.size <= 65_536 ? townDensityAt(wx, wz) : 0;
      land[k * 4 + 2] = crater;
      const cd = coastDistance(wx, wz);
      land[k * 4 + 3] = 1 - smoothstep(60, 260, cd);
    }
  // Skirt vertices copy edge vertices, dropped down.
  const drop = Math.min(250, Math.max(8, step * 1.5));
  const grid = v * v;
  const copy = (dst: number, src: number) => {
    positions[dst * 3] = positions[src * 3];
    positions[dst * 3 + 1] = positions[src * 3 + 1] - drop;
    positions[dst * 3 + 2] = positions[src * 3 + 2];
    for (let c = 0; c < 3; c++) normals[dst * 3 + c] = normals[src * 3 + c];
    for (let c = 0; c < 4; c++) land[dst * 4 + c] = land[src * 4 + c];
    front[dst] = front[src];
  };
  for (let k = 0; k <= n; k++) {
    copy(grid + 0 * v + k, k); // north
    copy(grid + 1 * v + k, n * v + k); // south
    copy(grid + 2 * v + k, k * v); // west
    copy(grid + 3 * v + k, k * v + n); // east
  }
  return { id: req.id, positions, normals, land, front, minY, maxY };
}
