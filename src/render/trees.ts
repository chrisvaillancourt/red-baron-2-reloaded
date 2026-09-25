/**
 * Instanced trees streamed in 500 m cells around the camera: woodland,
 * scattered field trees, poplar rows along roads, and shattered stumps in
 * the battle zone. Cells are generated a few per frame (nearest first) and
 * their instance matrices cached; the visible set is packed into a handful
 * of large InstancedMeshes (near detailed / far simple).
 */
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeightAt } from '../world/terrain';
import { buildTreeCell, CELL, KIND_BROAD, KIND_STUMP, KINDS, type CellData, type Season, type TreeCellRequest } from './treeCells';
import type { QualityPreset } from './quality';

const NEAR_DIST = 1300;

function paint(g: BufferGeometry, c: Color): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  g.setAttribute('crown', new Float32BufferAttribute(new Float32Array(n), 1));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** Vertex colours darkening toward the bottom of the crown (cheap self-shadowing). */
function paintCrown(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position');
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
  }
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - y0) / Math.max(1e-3, y1 - y0);
    const k = 0.55 + 0.5 * t;
    a[i * 3] = k;
    a[i * 3 + 1] = k;
    a[i * 3 + 2] = k * 0.95;
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  g.setAttribute('crown', new Float32BufferAttribute(new Float32Array(p.count).fill(1), 1));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function jitterSphere(g: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const p = g.getAttribute('position');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Jitter shared positions consistently (non-indexed geometry duplicates vertices).
  const map = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let f = map.get(k);
    if (f === undefined) map.set(k, (f = 1 + (r() - 0.5) * amount));
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

function ni(g: BufferGeometry): BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

const BARK = new Color('#4a3b2c');

function broadleaf(detail: boolean): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.18, 0.28, 3.2, detail ? 6 : 4).translate(0, 1.6, 0), BARK);
  const crown = paintCrown(jitterSphere(new IcosahedronGeometry(1, detail ? 1 : 0), 0.35, 11).scale(3.2, 3.6, 3.2).translate(0, 5.6, 0));
  if (detail) {
    const c2 = paintCrown(jitterSphere(new IcosahedronGeometry(1, 1), 0.4, 23).scale(2.2, 2.4, 2.2).translate(1.4, 4.4, 0.6));
    return mergeGeometries([ni(trunk), ni(crown), ni(c2)])!;
  }
  return mergeGeometries([ni(trunk), ni(crown)])!;
}

function poplar(detail: boolean): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.15, 0.25, 2.5, detail ? 6 : 4).translate(0, 1.25, 0), BARK);
  const crown = paintCrown(jitterSphere(new IcosahedronGeometry(1, detail ? 1 : 0), 0.25, 5).scale(1.5, 7, 1.5).translate(0, 8.5, 0));
  return mergeGeometries([ni(trunk), ni(crown)])!;
}

function stump(): BufferGeometry {
  const t = paint(new CylinderGeometry(0.07, 0.2, 1, 5).translate(0, 0.5, 0), new Color('#6e655a'));
  const b = paint(new CylinderGeometry(0.02, 0.07, 0.8, 3).rotateZ(0.7).translate(0.25, 0.75, 0), new Color('#5b5248'));
  return mergeGeometries([ni(t), ni(b)])!;
}

function farTree(): BufferGeometry {
  const crown = paintCrown(new OctahedronGeometry(1, 0).scale(3.2, 4.2, 3.2).translate(0, 5, 0));
  return ni(crown);
}

export class TreeLayer {
  readonly group = new Group();
  private readonly cells = new Map<string, CellData>();
  private readonly meshes: InstancedMesh[] = [];
  private readonly farMesh: InstancedMesh;
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  /** 1 in winter: crowns become a see-through tangle of twigs (alpha-to-coverage, no sorting). */
  private readonly bareUniform = { value: 0 };
  private date: string;
  private season: Season = 'summer';
  private lastPackPos = new Vector3(1e9, 0, 0);
  private lastPackTime = 0;
  private agl = 0;
  private dirty = true;
  /** Cell generation runs in a worker; results for a stale date/season generation are dropped. */
  private worker: Worker | null = null;
  private readonly requests = new Map<number, { key: string; gen: number }>();
  private readonly inFlight = new Set<string>();
  private generation = 0;
  private nextId = 1;
  private readonly capacity: number;

  constructor(
    date: string,
    private readonly q: QualityPreset,
  ) {
    this.date = date;
    this.group.name = 'trees';
    // Winter: crowns are a sparse tangle of bare twigs. Alpha-to-coverage (MSAA) gives
    // stable see-through canopies without transparency sorting; opaque when MSAA is off.
    this.material.alphaToCoverage = true;
    const bare = this.bareUniform;
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uBare = bare;
      sh.vertexShader = 'attribute float crown;\nvarying float vCrown;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrown = crown;');
      sh.fragmentShader = 'uniform float uBare;\nvarying float vCrown;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a = mix(1.0, 0.38, uBare * vCrown);',
      );
    };
    this.material.customProgramCacheKey = () => 'rb2-trees-v1';
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./treeWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; cell: CellData }>) => this.onCell(e.data.id, e.data.cell);
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          this.requests.clear();
          this.inFlight.clear();
        };
      } catch {
        this.worker = null;
      }
    }
    this.capacity = Math.round(60_000 * q.treeDensity + 10_000);
    const geos = [broadleaf(true), poplar(true), stump()];
    for (let k = 0; k < KINDS; k++) {
      const m = new InstancedMesh(geos[k], this.material, k === KIND_BROAD ? this.capacity : Math.round(this.capacity / 3));
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      this.meshes.push(m);
      this.group.add(m);
    }
    this.farMesh = new InstancedMesh(farTree(), this.material, this.capacity * 2);
    this.farMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.farMesh.count = 0;
    this.farMesh.frustumCulled = false;
    this.group.add(this.farMesh);
  }

  setDate(date: string): void {
    this.date = date;
    this.cells.clear();
    this.invalidate();
    this.dirty = true;
  }

  setSeason(s: Season): void {
    if (s === this.season) return;
    this.season = s;
    this.bareUniform.value = s === 'winter' ? 1 : 0;
    this.cells.clear();
    this.invalidate();
    this.dirty = true;
  }

  /** Cells in range still waiting to be built (for loading screens). */
  pendingCount = 0;
  /** Diagnostics: worst build/pack ms and counts since last read (see WorldRenderer.stats). */
  readonly perf = { buildMax: 0, packMax: 0, packs: 0, built: 0 };

  takePerf(): Record<string, number> {
    const p = { ...this.perf, instances: this.meshes.reduce((n, m) => n + m.count, this.farMesh.count), cells: this.cells.size };
    this.perf.buildMax = this.perf.packMax = this.perf.packs = this.perf.built = 0;
    return p;
  }

  private invalidate(): void {
    this.generation++;
    this.inFlight.clear();
  }

  private onCell(id: number, cell: CellData): void {
    const r = this.requests.get(id);
    this.requests.delete(id);
    if (!r) return;
    this.inFlight.delete(r.key);
    if (r.gen !== this.generation) return;
    this.cells.set(r.key, cell);
    this.dirty = true;
    this.perf.built++;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  update(cam: Vector3): void {
    const R = this.q.treeRadius;
    // Build a few cells per frame, nearest first.
    const need: [number, number, number][] = [];
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL);
    const rc = Math.ceil(R / CELL);
    const heightFade = cam.y - terrainHeightAt(cam.x, cam.z);
    this.agl = heightFade;
    // At high altitude individual trees are sub-pixel: shrink the radius.
    const effR = heightFade > 2500 ? R * 0.5 : R;
    for (let i = -rc; i <= rc; i++)
      for (let j = -rc; j <= rc; j++) {
        const x = (cx + i + 0.5) * CELL, z = (cz + j + 0.5) * CELL;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > effR + CELL) continue;
        if (!this.cells.has(`${cx + i},${cz + j}`)) need.push([cx + i, cz + j, d]);
      }
    need.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    let built = 0;
    if (this.worker) {
      // Keep a few requests in flight, nearest first.
      for (const [i, j] of need) {
        if (this.inFlight.size >= 6) break;
        const key = `${i},${j}`;
        if (this.inFlight.has(key)) continue;
        const id = this.nextId++;
        this.requests.set(id, { key, gen: this.generation });
        this.inFlight.add(key);
        const req: TreeCellRequest = { id, ix: i, iz: j, date: this.date, season: this.season, density: this.q.treeDensity };
        this.worker.postMessage(req);
      }
    } else {
      for (const [i, j] of need) {
        if (performance.now() - t0 > 4) break;
        this.cells.set(`${i},${j}`, buildTreeCell(i, j, this.date, this.season, this.q.treeDensity));
        this.dirty = true;
        built++;
      }
    }
    this.pendingCount = need.length - built;
    this.perf.buildMax = Math.max(this.perf.buildMax, performance.now() - t0);
    this.perf.built += built;
    const now = performance.now();
    if ((this.dirty && now - this.lastPackTime > 300) || cam.distanceTo(this.lastPackPos) > 120) {
      this.lastPackTime = now;
      const tp = performance.now();
      this.pack(cam, effR);
      const dtp = performance.now() - tp;
      this.perf.packMax = Math.max(this.perf.packMax, dtp);
      this.perf.packs++;
    }
    // Evict far cells.
    if (this.cells.size > 1200) {
      for (const [k, c] of this.cells) if (Math.hypot(c.cx - cam.x, c.cz - cam.z) > R * 2) this.cells.delete(k);
    }
  }

  private pack(cam: Vector3, R: number): void {
    this.dirty = false;
    this.lastPackPos.copy(cam);
    const counts = [0, 0, 0];
    let far = 0;
    const farArr = this.farMesh.instanceMatrix.array as Float32Array;
    const farCol = this.farMesh.instanceColor;
    for (const c of this.cells.values()) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z, Math.max(0, this.agl - 50));
      if (d > R + CELL) continue;
      const near = d < NEAR_DIST;
      for (let k = 0; k < KINDS; k++) {
        const kd = c.kinds[k];
        if (!kd.n) continue;
        if (near || k === KIND_STUMP) {
          const mesh = this.meshes[k];
          const cap = mesh.instanceMatrix.count;
          const take = Math.min(kd.n, cap - counts[k]);
          if (take <= 0) continue;
          (mesh.instanceMatrix.array as Float32Array).set(kd.m.subarray(0, take * 16), counts[k] * 16);
          this.ensureColor(mesh).array.set(kd.c.subarray(0, take * 3), counts[k] * 3);
          counts[k] += take;
        } else {
          const cap = this.farMesh.instanceMatrix.count;
          const take = Math.min(kd.n, cap - far);
          if (take <= 0) continue;
          farArr.set(kd.m.subarray(0, take * 16), far * 16);
          this.ensureColor(this.farMesh).array.set(kd.c.subarray(0, take * 3), far * 3);
          far += take;
        }
      }
    }
    for (let k = 0; k < KINDS; k++) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      // Upload only the live range (the buffers are sized for the worst case).
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, counts[k] * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, counts[k] * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.farMesh.count = far;
    this.farMesh.instanceMatrix.clearUpdateRanges();
    this.farMesh.instanceMatrix.addUpdateRange(0, far * 16);
    this.farMesh.instanceMatrix.needsUpdate = true;
    if (farCol) {
      farCol.clearUpdateRanges();
      farCol.addUpdateRange(0, far * 3);
      farCol.needsUpdate = true;
    }
    if (this.farMesh.instanceColor) this.farMesh.instanceColor.needsUpdate = true;
  }

  private ensureColor(mesh: InstancedMesh) {
    if (!mesh.instanceColor) mesh.setColorAt(0, new Color(1, 1, 1));
    return mesh.instanceColor!;
  }

  get instanceCount(): number {
    return this.meshes.reduce((a, m) => a + m.count, 0) + this.farMesh.count;
  }
}
