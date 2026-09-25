/**
 * Building placement for one 8 km town tile: streets of houses, old-town
 * blocks, churches and farmsteads, ruined near the front. Pure (three math
 * only) so it runs in a web worker (townWorker.ts): a city tile takes
 * ~100-200 ms, far too long for the main thread. The result is packed
 * instance matrices and colours, ready for InstancedMesh.
 */
import { Color, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { craterIntensityAt, signedDistanceToFront } from '../world/frontline';
import { forestDensityAt, TOWNS_WORLD, townDensityAt } from '../world/landuse';
import { coastDistance, riverQuery, terrainHeightAt } from '../world/terrain';

export const TILE = 8000;

export interface TownTileRequest {
  id: number;
  cx: number;
  cz: number;
  date: string;
  buildingDistance: number;
}

/** Packed instances: matrices (16 floats) and optional colours (3 floats) per instance. */
export interface InstanceSet {
  m: Float32Array;
  c: Float32Array | null;
  n: number;
}

export interface TownTileData {
  walls: InstanceSet;
  roofs: InstanceSet;
  ruins: InstanceSet;
  churches: InstanceSet;
  ruinedChurches: InstanceSet;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hashXY(x: number, z: number, k = 0): number {
  let h = Math.imul(Math.floor(x) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(z) | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

interface Building {
  x: number;
  z: number;
  y: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  roofH: number;
  wall: Color;
  roof: Color;
  ruined: boolean;
}

const WALLS = ['#834736', '#8c513c', '#774233', '#b5ad9e', '#a9a08e', '#918b82', '#a38e68'].map((c) => new Color(c));
const ROOFS = ['#823a2b', '#733426', '#4a4c52', '#56585e', '#663a2f', '#86492f'].map((c) => new Color(c));
const RUIN = new Color('#5f5850');

/** Probability a building here lies in ruins: shelled within artillery range of the line, or fought over before. */
function ruinChance(date: string, x: number, z: number): number {
  const cr = craterIntensityAt(x, z, date);
  const d = Math.abs(signedDistanceToFront(x, z, date));
  const shelled = (1 - Math.min(1, Math.max(0, (d - 1500) / 7500))) ** 1.5 * 0.85;
  return Math.min(0.97, Math.max(cr * 1.4 - 0.15, shelled));
}

function makeHouse(date: string, x: number, z: number, rot: number, r: () => number, scale: number, farm = false): Building {
  const w = (6 + r() * 5) * scale * (farm ? 1.3 : 1);
  const d = (8 + r() * 7) * scale * (farm ? 1.6 : 1);
  const h = (farm ? 4 + r() * 2 : 5 + r() * 4.5) * (scale > 1.2 ? 1.25 : 1);
  const ruined = r() < ruinChance(date, x, z);
  return {
    x,
    z,
    y: terrainHeightAt(x, z),
    rot,
    w,
    d,
    h,
    roofH: 2.5 + r() * 2.5,
    wall: WALLS[Math.floor(r() * WALLS.length)].clone().multiplyScalar(0.88 + r() * 0.2),
    roof: ROOFS[Math.floor(r() * ROOFS.length)].clone().multiplyScalar(0.85 + r() * 0.25),
    ruined,
  };
}

export function buildTownTile(cx: number, cz: number, date: string, buildingDistance: number): TownTileData {
    const x0 = cx - TILE / 2;
    const z0 = cz - TILE / 2;
    const houses: Building[] = [];
    const churches: { x: number; y: number; z: number; rot: number; s: number; ruined: boolean }[] = [];

    // Towns whose centre lies in this tile.
    for (const town of TOWNS_WORLD) {
      if (town.x < x0 || town.x >= x0 + TILE || town.z < z0 || town.z >= z0 + TILE) continue;
      const r = rng(hashXY(town.x, town.z, 5));
      const big = town.size === 'city';
      const scale = big ? 1.25 : 1;
      const density = buildingDistance < 12_000 ? 0.45 : 1;
      const baseAng = r() * Math.PI;
      const cr = ruinChance(date, town.x, town.z);
      churches.push({ x: town.x, z: town.z, y: terrainHeightAt(town.x, town.z), rot: baseAng, s: big ? 1.8 : town.size === 'town' ? 1.25 : 0.9, ruined: cr > 0.55 });
      const R = town.radius;
      // Houses line both sides of each street, closely spaced near the centre.
      const lineStreet = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        const rot = Math.atan2(dx, dz);
        for (let s = 0; s < len; s += 9 + r() * 4) {
          const cx = ax + dx * s, cz = az + dz * s;
          const dc = Math.hypot(cx - town.x, cz - town.z);
          if (dc < 35 || dc > R * 1.05) continue;
          const keep = (1 - Math.pow(dc / R, 2.2)) * density;
          for (const side of [-1, 1]) {
            if (r() > keep) continue;
            const off = side * (8 + r() * 3);
            houses.push(makeHouse(date, cx - dz * off, cz + dx * off, rot, r, scale));
          }
        }
      };
      const streets = big ? 14 : town.size === "town" ? 9 : 4;
      const radA: number[] = [];
      const radB: number[] = [];
      for (let k = 0; k < streets; k++) {
        const a = baseAng + (k / streets) * Math.PI * 2 + (r() - 0.5) * 0.3;
        const bend = (r() - 0.5) * 0.4;
        radA.push(a);
        radB.push(bend);
        const mid = R * 0.5;
        const mx = town.x + Math.cos(a) * mid, mz = town.z + Math.sin(a) * mid;
        const ex = town.x + Math.cos(a + bend) * R, ez = town.z + Math.sin(a + bend) * R;
        lineStreet(town.x, town.z, mx, mz);
        lineStreet(mx, mz, ex, ez);
      }
      if (town.size !== 'village') {
        // Irregular cross streets linking neighbouring radials.
        const radialPt = (k: number, d: number) => {
          const a = radA[k] + (d > R * 0.5 ? radB[k] * ((d - R * 0.5) / (R * 0.5)) : 0);
          return [town.x + Math.cos(a) * d, town.z + Math.sin(a) * d];
        };
        const cross = big ? 4 : 2;
        for (let k = 0; k < streets; k++)
          for (let c = 0; c < cross; c++) {
            if (r() < 0.3) continue;
            const d1 = R * (0.18 + 0.62 * r());
            const d2 = d1 * (0.75 + 0.5 * r());
            const [ax, az] = radialPt(k, d1);
            const [bx, bz] = radialPt((k + 1) % streets, Math.min(R, d2));
            lineStreet(ax, az, bx, bz);
          }
      }
      if (town.size !== "village") {
        // Dense old town: a grid of blocks around the Grand-Place.
        const c = Math.cos(baseAng), s = Math.sin(baseAng);
        const half = R * (big ? 0.28 : 0.24);
        for (let gx = -half; gx <= half; gx += 11)
          for (let gz = -half; gz <= half; gz += 26) {
            if (Math.abs(gx) < 45 && Math.abs(gz) < 45) continue;
            if (r() > 0.8 * density) continue;
            for (const side of [-6.5, 6.5]) {
              const lx = gx, lz = gz + side;
              houses.push(makeHouse(date, town.x + lx * c - lz * s, town.z + lx * s + lz * c, baseAng, r, 1.3));
            }
          }
      }
    }

    // Farms (courtyard farmsteads) on a 1.4 km grid.
    const FC = 1400;
    for (let fx = Math.floor(x0 / FC); fx * FC < x0 + TILE; fx++)
      for (let fz = Math.floor(z0 / FC); fz * FC < z0 + TILE; fz++) {
        const h = hashXY(fx, fz, 77);
        if (h % 100 > 55) continue;
        const r = rng(h);
        const x = (fx + 0.15 + r() * 0.7) * FC;
        const z = (fz + 0.15 + r() * 0.7) * FC;
        if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE) continue;
        if (coastDistance(x, z) < 300) continue;
        if (townDensityAt(x, z) > 0.05 || forestDensityAt(x, z) > 0.3) continue;
        const rq = riverQuery(x, z, 150);
        if (rq.river && rq.distance < 120) continue;
        const rot = r() * Math.PI * 2;
        const c = Math.cos(rot), s = Math.sin(rot);
        const n = 2 + Math.floor(r() * 3);
        const spots: [number, number, number][] = [[0, -14, 0], [-13, 2, Math.PI / 2], [13, 2, Math.PI / 2], [0, 16, 0]];
        for (let k = 0; k < n; k++) {
          const [lx, lz, lr] = spots[k];
          houses.push(makeHouse(date, x + lx * c - lz * s, z + lx * s + lz * c, rot + lr, r, k === 0 ? 1.15 : 0.95, true));
        }
      }

  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  const set = (n: number, colors: boolean): InstanceSet => ({ m: new Float32Array(n * 16), c: colors ? new Float32Array(n * 3) : null, n });
  const intact = houses.filter((b) => !b.ruined);
  const ruined = houses.filter((b) => b.ruined);
  const walls = set(intact.length, true);
  const roofs = set(intact.length, true);
  intact.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m.compose(pos.set(b.x, b.y - 0.5, b.z), q, scl.set(b.w, b.h + 0.5, b.d)).toArray(walls.m, i * 16);
    m.compose(pos.set(b.x, b.y + b.h, b.z), q, scl.set(b.w, b.roofH, b.d)).toArray(roofs.m, i * 16);
    b.wall.toArray(walls.c!, i * 3);
    b.roof.toArray(roofs.c!, i * 3);
  });
  const ruins = set(ruined.length, true);
  ruined.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m.compose(pos.set(b.x, b.y - 0.3, b.z), q, scl.set(b.w, b.h * 0.9, b.d)).toArray(ruins.m, i * 16);
    RUIN.clone().multiplyScalar(0.8 + ((i * 37) % 10) * 0.04).toArray(ruins.c!, i * 3);
  });
  const o = new Object3D();
  const intactChurches = churches.filter((c) => !c.ruined);
  const ch = set(intactChurches.length, false);
  intactChurches.forEach((c, i) => {
    o.position.set(c.x, c.y - 0.5, c.z);
    o.rotation.set(0, c.rot, 0);
    o.scale.setScalar(c.s);
    o.updateMatrix();
    o.matrix.toArray(ch.m, i * 16);
  });
  const ruinedChurches = churches.filter((c) => c.ruined);
  const rch = set(ruinedChurches.length * 2, true);
  ruinedChurches.forEach((c, i) => {
    o.position.set(c.x, c.y - 0.3, c.z);
    o.rotation.set(0, c.rot, 0);
    o.scale.set(11 * c.s, 9 * c.s, 28 * c.s);
    o.updateMatrix();
    o.matrix.toArray(rch.m, i * 2 * 16);
    o.position.set(c.x + Math.sin(c.rot) * 16 * c.s, c.y - 0.3, c.z + Math.cos(c.rot) * 16 * c.s);
    o.scale.set(6.5 * c.s, 14 * c.s, 6.5 * c.s);
    o.updateMatrix();
    o.matrix.toArray(rch.m, (i * 2 + 1) * 16);
    RUIN.toArray(rch.c!, i * 2 * 3);
    RUIN.toArray(rch.c!, (i * 2 + 1) * 3);
  });
  return { walls, roofs, ruins, churches: ch, ruinedChurches: rch };
}
