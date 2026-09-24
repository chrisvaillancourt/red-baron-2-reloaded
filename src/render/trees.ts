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
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { craterIntensityAt } from '../world/frontline';
import { aerodromeClearance, forestDensityAt, townDensityAt } from '../world/landuse';
import { roadNetwork } from '../world/roads';
import { coastDistance, riverQuery, terrainHeightAt, valueNoise } from '../world/terrain';
import type { QualityPreset } from './quality';

const CELL = 500;
const NEAR_DIST = 1300;

type Season = 'winter' | 'spring' | 'summer' | 'autumn';

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

const STUMP_TINT = new Color(1.25, 1.2, 1.15);
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

interface CellData {
  key: string;
  cx: number;
  cz: number;
  // Per kind: packed matrices (16 floats) and colours (3 floats)
  kinds: { m: Float32Array; c: Float32Array; n: number }[];
}

const KIND_BROAD = 0;
const KIND_POPLAR = 1;
const KIND_STUMP = 2;
const KINDS = 3;

function hash(x: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const SEASON_LEAF: Record<Season, string[]> = {
  spring: ['#5f8a3a', '#6d9442', '#557f35', '#79a04a'],
  summer: ['#3f5f2b', '#4a6a30', '#355426', '#56753a'],
  autumn: ['#77683a', '#85613c', '#66683a', '#6f5433', '#56602f'],
  // Bare winter crowns: twig-grey, drawn see-through via alpha-to-coverage (see bareUniform).
  winter: ['#5d5550', '#655b52', '#554e49', '#6b6158'],
};

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
  private roadCells: Map<string, { ax: number; az: number; bx: number; bz: number }[]> | null = null;
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
    this.dirty = true;
  }

  setSeason(s: Season): void {
    if (s === this.season) return;
    this.season = s;
    this.bareUniform.value = s === 'winter' ? 1 : 0;
    this.cells.clear();
    this.dirty = true;
  }

  private roadsIn(key: string) {
    if (!this.roadCells) {
      this.roadCells = new Map();
      for (const r of roadNetwork()) {
        if (!r.major && hash(r.points[0].x, r.points[0].z, 3) > 0.5) continue; // only some lanes lined
        for (let i = 0; i < r.points.length - 1; i++) {
          const a = r.points[i], b = r.points[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const steps = Math.ceil(len / (CELL / 2));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const k = `${Math.floor((a.x + (b.x - a.x) * t) / CELL)},${Math.floor((a.z + (b.z - a.z) * t) / CELL)}`;
            let arr = this.roadCells.get(k);
            if (!arr) this.roadCells.set(k, (arr = []));
            const last = arr[arr.length - 1];
            if (!last || last.ax !== a.x || last.bx !== b.x) arr.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
          }
        }
      }
    }
    return this.roadCells.get(key) ?? [];
  }

  private buildCell(ix: number, iz: number): CellData {
    const key = `${ix},${iz}`;
    const x0 = ix * CELL;
    const z0 = iz * CELL;
    const lists: number[][] = [[], [], []];
    const cols: number[][] = [[], [], []];
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const p = new Vector3();
    const s = new Vector3();
    const leaf = SEASON_LEAF[this.season].map((c) => new Color(c));
    const push = (kind: number, x: number, z: number, scale: number, rot: number, color: Color) => {
      q.setFromAxisAngle(up, rot);
      m.compose(p.set(x, terrainHeightAt(x, z) - 0.3, z), q, s.set(scale, scale * (0.85 + 0.3 * hash(x, z, 9)), scale));
      lists[kind].push(...m.elements);
      cols[kind].push(color.r, color.g, color.b);
    };
    const spacing = 9.5 / Math.sqrt(this.q.treeDensity);
    const n = Math.floor(CELL / spacing);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const hx = hash(ix * 97 + i, iz * 89 + j, 1);
        const hz = hash(ix * 97 + i, iz * 89 + j, 2);
        const x = x0 + (i + hx) * spacing;
        const z = z0 + (j + hz) * spacing;
        const f = forestDensityAt(x, z);
        const noise = (valueNoise(x / 40, z / 40, 5)) * 0.06;
        const crater = craterIntensityAt(x, z, this.date);
        if (f + noise > 0.5) {
          if (crater > 0.55) {
            if (hash(x, z, 4) < 0.22) push(KIND_STUMP, x, z, 1.2 + 2.5 * hash(x, z, 5), hash(x, z, 6) * 6.28, STUMP_TINT);
            continue;
          }
          const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.8 + 0.4 * hash(x, z, 8));
          push(KIND_BROAD, x, z, 0.9 + 0.8 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
        } else if (hash(x, z, 11) < 0.004 * this.q.treeDensity && crater < 0.4) {
          // Lone field / hedgerow trees.
          if (townDensityAt(x, z) > 0.4 || aerodromeClearance(x, z) < 1) continue;
          if (coastDistance(x, z) < 200) continue;
          const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.85 + 0.3 * hash(x, z, 8));
          push(KIND_BROAD, x, z, 0.8 + 0.7 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
        } else if (crater > 0.6 && hash(x, z, 12) < 0.004) {
          push(KIND_STUMP, x, z, 1 + 1.5 * hash(x, z, 5), hash(x, z, 6) * 6.28, STUMP_TINT);
        }
      }
    // Poplars along roads (and some river banks).
    for (const seg of this.roadsIn(key)) {
      const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
      const dx = (seg.bx - seg.ax) / len, dz = (seg.bz - seg.az) / len;
      const spacingP = 14;
      for (let d = 0; d < len; d += spacingP) {
        const cx = seg.ax + dx * d, cz = seg.az + dz * d;
        if (cx < x0 || cx >= x0 + CELL || cz < z0 || cz >= z0 + CELL) continue;
        if (townDensityAt(cx, cz) > 0.3) continue;
        const crater = craterIntensityAt(cx, cz, this.date);
        for (const sd of [-1, 1]) {
          const x = cx - dz * 9 * sd, z = cz + dx * 9 * sd;
          if (hash(x, z, 13) < 0.15) continue;
          if (crater > 0.5) {
            if (hash(x, z, 14) < 0.3) push(KIND_STUMP, x, z, 2 + 3 * hash(x, z, 5), 0, STUMP_TINT);
            continue;
          }
          const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(0.85 + 0.25 * hash(x, z, 8));
          push(KIND_POPLAR, x, z, 0.85 + 0.35 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
        }
      }
    }
    // Willows along rivers near the water.
    const rq = riverQuery(x0 + CELL / 2, z0 + CELL / 2, CELL);
    if (rq.river && rq.distance < CELL) {
      for (let k = 0; k < 40; k++) {
        const x = x0 + hash(ix, iz, 20 + k) * CELL;
        const z = z0 + hash(ix, iz, 60 + k) * CELL;
        const r2 = riverQuery(x, z, 80);
        if (!r2.river || r2.distance < r2.river.width * 0.6 + 3 || r2.distance > r2.river.width * 0.6 + 25) continue;
        if (craterIntensityAt(x, z, this.date) > 0.5) continue;
        const c = leaf[Math.floor(hash(x, z, 7) * leaf.length)].clone().multiplyScalar(1.05);
        push(KIND_BROAD, x, z, 0.8 + 0.4 * hash(x, z, 3), hash(x, z, 6) * 6.28, c);
      }
    }
    return {
      key,
      cx: x0 + CELL / 2,
      cz: z0 + CELL / 2,
      kinds: lists.map((l, k) => ({ m: new Float32Array(l), c: new Float32Array(cols[k]), n: l.length / 16 })),
    };
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
    for (const [i, j] of need) {
      if (performance.now() - t0 > 4) break;
      this.cells.set(`${i},${j}`, this.buildCell(i, j));
      this.dirty = true;
    }
    const now = performance.now();
    if ((this.dirty && now - this.lastPackTime > 300) || cam.distanceTo(this.lastPackPos) > 120) {
      this.lastPackTime = now;
      this.pack(cam, effR);
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
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.farMesh.count = far;
    this.farMesh.instanceMatrix.needsUpdate = true;
    if (farCol) farCol.needsUpdate = true;
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
