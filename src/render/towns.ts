/**
 * Towns, villages and scattered farms as instanced buildings, built lazily
 * in 8 km tiles around the camera. Buildings near the front are ruined
 * according to the cratering history (Ypres, Albert, Arras...).
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { craterIntensityAt, signedDistanceToFront } from '../world/frontline';
import { forestDensityAt, TOWNS_WORLD, townDensityAt } from '../world/landuse';
import { coastDistance, riverQuery, terrainHeightAt } from '../world/terrain';
import type { QualityPreset } from './quality';

const TILE = 8000;

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

// --- geometries (unit sized, base at y = 0) ---------------------------------
function gableRoof(): BufferGeometry {
  // Unit footprint 1x1 (x: -0.5..0.5, z: -0.5..0.5), ridge along z at height 1.
  const v = [
    // left slope
    -0.55, 0, -0.55, 0, 1, -0.55, 0, 1, 0.55, -0.55, 0, -0.55, 0, 1, 0.55, -0.55, 0, 0.55,
    // right slope
    0.55, 0, -0.55, 0.55, 0, 0.55, 0, 1, 0.55, 0.55, 0, -0.55, 0, 1, 0.55, 0, 1, -0.55,
    // gable ends
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function wallBox(): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  return g;
}

function colored(g: BufferGeometry, c: Color): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
}

function ruinGeometry(): BufferGeometry {
  // Four broken walls with jagged tops, no roof, plus a rubble heap.
  const parts: BufferGeometry[] = [];
  const r = rng(99);
  const wall = (x: number, z: number, w: number, d: number) => {
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const h = 0.15 + r() * 0.75;
      const b = new BoxGeometry(w / segs, h, d);
      b.translate(x - w / 2 + (w / segs) * (i + 0.5), h / 2, z);
      parts.push(b);
    }
  };
  wall(0, -0.47, 1, 0.06);
  wall(0, 0.47, 1, 0.06);
  const side = (x: number) => {
    for (let i = 0; i < 3; i++) {
      const h = 0.1 + r() * 0.6;
      const b = new BoxGeometry(0.06, h, 1 / 3);
      b.translate(x, h / 2, -0.5 + (i + 0.5) / 3);
      parts.push(b);
    }
  };
  side(-0.47);
  side(0.47);
  const heap = new BoxGeometry(0.7, 0.18, 0.6);
  heap.translate(0.05, 0.09, 0);
  parts.push(heap);
  const g = mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
  return g;
}

function churchGeometry(): BufferGeometry {
  const stone = new Color('#9a948a');
  const slate = new Color('#4d4f55');
  const nave = colored(wallBox().scale(10, 11, 28), stone);
  const naveRoof = colored(gableRoof().scale(10.5, 6, 28.5).translate(0, 11, 0), slate);
  const tower = colored(wallBox().scale(6, 22, 6).translate(0, 0, 16), stone);
  const spire = new BufferGeometry();
  // Four-sided pyramid spire
  const s = 3.4, h = 16, y0 = 22;
  const pv = [-s, y0, -s, s, y0, -s, 0, y0 + h, 0, s, y0, -s, s, y0, s, 0, y0 + h, 0, s, y0, s, -s, y0, s, 0, y0 + h, 0, -s, y0, s, -s, y0, -s, 0, y0 + h, 0];
  spire.setAttribute('position', new Float32BufferAttribute(pv, 3));
  spire.translate(0, 0, 16);
  spire.computeVertexNormals();
  colored(spire, slate);
  [nave, tower].forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries([nave, naveRoof, tower, spire].map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

// --- placement ---------------------------------------------------------------

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

interface Tile {
  key: string;
  group: Group;
  built: boolean;
  cx: number;
  cz: number;
}

export class TownLayer {
  readonly group = new Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly wallGeo = wallBox();
  private readonly roofGeo = gableRoof();
  private readonly ruinGeo = ruinGeometry();
  private readonly churchGeo = churchGeometry();
  private readonly wallMat = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  private readonly roofMat = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  private readonly churchMat = new MeshStandardMaterial({ roughness: 0.9, vertexColors: true });
  private date: string;

  constructor(
    date: string,
    private readonly q: QualityPreset,
  ) {
    this.date = date;
    this.group.name = 'towns';
  }

  setDate(date: string): void {
    this.date = date;
    for (const t of this.tiles.values()) this.clearTile(t);
    this.tiles.clear();
  }

  private clearTile(t: Tile): void {
    this.group.remove(t.group);
    t.group.traverse((o) => {
      if (o instanceof InstancedMesh) o.dispose();
    });
  }

  /** Tiles in range still waiting to be built (for loading screens). */
  pendingCount = 0;

  update(cam: Vector3): void {
    const R = this.q.buildingDistance;
    const t0x = Math.floor((cam.x - R) / TILE);
    const t1x = Math.floor((cam.x + R) / TILE);
    const t0z = Math.floor((cam.z - R) / TILE);
    const t1z = Math.floor((cam.z + R) / TILE);
    let builtThisFrame = 0;
    const wanted: Tile[] = [];
    for (let ix = t0x; ix <= t1x; ix++)
      for (let iz = t0z; iz <= t1z; iz++) {
        const key = `${ix},${iz}`;
        let t = this.tiles.get(key);
        if (!t) {
          t = { key, group: new Group(), built: false, cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE };
          this.tiles.set(key, t);
        }
        wanted.push(t);
      }
    wanted.sort((a, b) => Math.hypot(a.cx - cam.x, a.cz - cam.z) - Math.hypot(b.cx - cam.x, b.cz - cam.z));
    for (const t of wanted) {
      if (!t.built && builtThisFrame < 1) {
        this.buildTile(t);
        builtThisFrame++;
      }
    }
    this.pendingCount = wanted.reduce((n, t) => n + (t.built ? 0 : 1), 0);
    for (const t of this.tiles.values()) {
      const d = Math.max(0, Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71);
      t.group.visible = t.built && d < R;
    }
  }

  private buildTile(t: Tile): void {
    t.built = true;
    const x0 = t.cx - TILE / 2;
    const z0 = t.cz - TILE / 2;
    const houses: Building[] = [];
    const churches: { x: number; y: number; z: number; rot: number; s: number; ruined: boolean }[] = [];

    // Towns whose centre lies in this tile.
    for (const town of TOWNS_WORLD) {
      if (town.x < x0 || town.x >= x0 + TILE || town.z < z0 || town.z >= z0 + TILE) continue;
      const r = rng(hashXY(town.x, town.z, 5));
      const big = town.size === 'city';
      const scale = big ? 1.25 : 1;
      const density = this.q.buildingDistance < 12_000 ? 0.45 : 1;
      const baseAng = r() * Math.PI;
      const cr = this.ruinChance(town.x, town.z);
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
            houses.push(this.makeHouse(cx - dz * off, cz + dx * off, rot, r, scale));
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
              houses.push(this.makeHouse(town.x + lx * c - lz * s, town.z + lx * s + lz * c, baseAng, r, 1.3));
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
          houses.push(this.makeHouse(x + lx * c - lz * s, z + lx * s + lz * c, rot + lr, r, k === 0 ? 1.15 : 0.95, true));
        }
      }

    if (houses.length) {
      const intact = houses.filter((b) => !b.ruined);
      const ruined = houses.filter((b) => b.ruined);
      const m = new Matrix4();
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const pos = new Vector3();
      const scl = new Vector3();
      if (intact.length) {
        const walls = new InstancedMesh(this.wallGeo, this.wallMat, intact.length);
        const roofs = new InstancedMesh(this.roofGeo, this.roofMat, intact.length);
        intact.forEach((b, i) => {
          q.setFromAxisAngle(up, b.rot);
          walls.setMatrixAt(i, m.compose(pos.set(b.x, b.y - 0.5, b.z), q, scl.set(b.w, b.h + 0.5, b.d)));
          roofs.setMatrixAt(i, m.compose(pos.set(b.x, b.y + b.h, b.z), q, scl.set(b.w, b.roofH, b.d)));
          walls.setColorAt(i, b.wall);
          roofs.setColorAt(i, b.roof);
        });
        for (const im of [walls, roofs]) {
          im.computeBoundingSphere();
          im.receiveShadow = true;
          t.group.add(im);
        }
      }
      if (ruined.length) {
        const ru = new InstancedMesh(this.ruinGeo, this.wallMat, ruined.length);
        ruined.forEach((b, i) => {
          q.setFromAxisAngle(up, b.rot);
          ru.setMatrixAt(i, m.compose(pos.set(b.x, b.y - 0.3, b.z), q, scl.set(b.w, b.h * 0.9, b.d)));
          ru.setColorAt(i, RUIN.clone().multiplyScalar(0.8 + ((i * 37) % 10) * 0.04));
        });
        ru.computeBoundingSphere();
        ru.receiveShadow = true;
        t.group.add(ru);
      }
    }
    const intactChurches = churches.filter((c) => !c.ruined);
    if (intactChurches.length) {
      const ch = new InstancedMesh(this.churchGeo, this.churchMat, intactChurches.length);
      const o = new Object3D();
      intactChurches.forEach((c, i) => {
        o.position.set(c.x, c.y - 0.5, c.z);
        o.rotation.set(0, c.rot, 0);
        o.scale.setScalar(c.s);
        o.updateMatrix();
        ch.setMatrixAt(i, o.matrix);
      });
      ch.computeBoundingSphere();
      t.group.add(ch);
    }
    const ruinedChurches = churches.filter((c) => c.ruined);
    if (ruinedChurches.length) {
      const ru = new InstancedMesh(this.ruinGeo, this.wallMat, ruinedChurches.length * 2);
      const o = new Object3D();
      ruinedChurches.forEach((c, i) => {
        o.position.set(c.x, c.y - 0.3, c.z);
        o.rotation.set(0, c.rot, 0);
        o.scale.set(11 * c.s, 9 * c.s, 28 * c.s);
        o.updateMatrix();
        ru.setMatrixAt(i * 2, o.matrix);
        o.position.set(c.x + Math.sin(c.rot) * 16 * c.s, c.y - 0.3, c.z + Math.cos(c.rot) * 16 * c.s);
        o.scale.set(6.5 * c.s, 14 * c.s, 6.5 * c.s);
        o.updateMatrix();
        ru.setMatrixAt(i * 2 + 1, o.matrix);
        ru.setColorAt(i * 2, RUIN);
        ru.setColorAt(i * 2 + 1, RUIN);
      });
      ru.computeBoundingSphere();
      t.group.add(ru);
    }
    this.group.add(t.group);
  }

  /** Probability a building here lies in ruins: shelled within artillery range of the line, or fought over before. */
  private ruinChance(x: number, z: number): number {
    const cr = craterIntensityAt(x, z, this.date);
    const d = Math.abs(signedDistanceToFront(x, z, this.date));
    const shelled = (1 - Math.min(1, Math.max(0, (d - 1500) / 7500))) ** 1.5 * 0.85;
    return Math.min(0.97, Math.max(cr * 1.4 - 0.15, shelled));
  }

  private makeHouse(x: number, z: number, rot: number, r: () => number, scale: number, farm = false): Building {
    const w = (6 + r() * 5) * scale * (farm ? 1.3 : 1);
    const d = (8 + r() * 7) * scale * (farm ? 1.6 : 1);
    const h = (farm ? 4 + r() * 2 : 5 + r() * 4.5) * (scale > 1.2 ? 1.25 : 1);
    const ruined = r() < this.ruinChance(x, z);
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
}
