/**
 * Towns, villages and scattered farms as instanced buildings, built lazily
 * in 8 km tiles around the camera. Placement (townTiles.ts) runs in a web
 * worker; buildings near the front are ruined according to the cratering
 * history (Ypres, Albert, Arras...).
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityPreset } from './quality';
import { buildTownTile, TILE, type InstanceSet, type TownTileData, type TownTileRequest } from './townTiles';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
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


// --- layer ---------------------------------------------------------------------

interface Tile {
  key: string;
  group: Group;
  built: boolean;
  requested: boolean;
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
  /** Tile placement runs in a worker (a city tile is ~100-200 ms); stale-date results are dropped. */
  private worker: Worker | null = null;
  private readonly requests = new Map<number, { key: string; gen: number }>();
  private generation = 0;
  private nextId = 1;

  /** Tiles in range still waiting to be built (for loading screens). */
  pendingCount = 0;
  /** Diagnostics: worst main-thread tile build/upload since last read. */
  buildMaxMs = 0;

  constructor(
    date: string,
    private readonly q: QualityPreset,
  ) {
    this.date = date;
    this.group.name = 'towns';
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./townWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; data: TownTileData }>) => this.onTile(e.data.id, e.data.data);
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          this.requests.clear();
          for (const t of this.tiles.values()) t.requested = false;
        };
      } catch {
        this.worker = null;
      }
    }
  }

  setDate(date: string): void {
    this.date = date;
    this.generation++;
    for (const t of this.tiles.values()) this.clearTile(t);
    this.tiles.clear();
  }

  private clearTile(t: Tile): void {
    this.group.remove(t.group);
    t.group.traverse((o) => {
      if (o instanceof InstancedMesh) o.dispose();
    });
  }

  update(cam: Vector3): void {
    const R = this.q.buildingDistance;
    const t0x = Math.floor((cam.x - R) / TILE);
    const t1x = Math.floor((cam.x + R) / TILE);
    const t0z = Math.floor((cam.z - R) / TILE);
    const t1z = Math.floor((cam.z + R) / TILE);
    const wanted: Tile[] = [];
    for (let ix = t0x; ix <= t1x; ix++)
      for (let iz = t0z; iz <= t1z; iz++) {
        const key = `${ix},${iz}`;
        let t = this.tiles.get(key);
        if (!t) {
          t = { key, group: new Group(), built: false, requested: false, cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE };
          this.tiles.set(key, t);
        }
        wanted.push(t);
      }
    wanted.sort((a, b) => Math.hypot(a.cx - cam.x, a.cz - cam.z) - Math.hypot(b.cx - cam.x, b.cz - cam.z));
    let inFlight = this.requests.size;
    let builtThisFrame = 0;
    for (const t of wanted) {
      if (t.built || t.requested) continue;
      if (this.worker) {
        if (inFlight >= 2) break;
        const id = this.nextId++;
        this.requests.set(id, { key: t.key, gen: this.generation });
        t.requested = true;
        inFlight++;
        const req: TownTileRequest = { id, cx: t.cx, cz: t.cz, date: this.date, buildingDistance: this.q.buildingDistance };
        this.worker.postMessage(req);
      } else if (builtThisFrame < 1) {
        const tb = performance.now();
        this.addTile(t, buildTownTile(t.cx, t.cz, this.date, this.q.buildingDistance));
        this.buildMaxMs = Math.max(this.buildMaxMs, performance.now() - tb);
        builtThisFrame++;
      }
    }
    this.pendingCount = wanted.reduce((n, t) => n + (t.built ? 0 : 1), 0);
    for (const t of this.tiles.values()) {
      const d = Math.max(0, Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71);
      t.group.visible = t.built && d < R;
    }
  }

  private onTile(id: number, data: TownTileData): void {
    const r = this.requests.get(id);
    this.requests.delete(id);
    if (!r || r.gen !== this.generation) return;
    const t = this.tiles.get(r.key);
    if (!t || t.built) return;
    const tb = performance.now();
    this.addTile(t, data);
    this.buildMaxMs = Math.max(this.buildMaxMs, performance.now() - tb);
  }

  private addTile(t: Tile, d: TownTileData): void {
    t.built = true;
    const add = (geo: BufferGeometry, mat: MeshStandardMaterial, s: InstanceSet, shadows: boolean) => {
      if (!s.n) return;
      const im = new InstancedMesh(geo, mat, s.n);
      im.instanceMatrix.array.set(s.m);
      if (s.c) im.instanceColor = new InstancedBufferAttribute(s.c, 3);
      im.computeBoundingSphere();
      im.receiveShadow = shadows;
      t.group.add(im);
    };
    add(this.wallGeo, this.wallMat, d.walls, true);
    add(this.roofGeo, this.roofMat, d.roofs, true);
    add(this.ruinGeo, this.wallMat, d.ruins, true);
    add(this.churchGeo, this.churchMat, d.churches, false);
    add(this.ruinGeo, this.wallMat, d.ruinedChurches, false);
    this.group.add(t.group);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
