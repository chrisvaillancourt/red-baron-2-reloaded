/**
 * Streamed quadtree LOD terrain. Chunks are generated in a worker pool (or
 * synchronously as a fallback), cached LRU, and selected each frame by
 * distance to the camera. A chunk whose children aren't ready yet keeps
 * drawing in their place, so there are never holes.
 */
import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Camera, type Material } from 'three';
import { buildChunk, buildChunkIndices, CHUNK_SEGMENTS, type ChunkData, type ChunkRequest } from './chunkBuilder';

const ROOT_SIZE = 262_144;
const ROOT_MIN = -ROOT_SIZE / 2;

interface Node {
  key: string;
  level: number;
  ix: number;
  iz: number;
  size: number;
  cx: number;
  cz: number;
  mesh: Mesh | null;
  pending: boolean;
  lastUsed: number;
  minY: number;
  maxY: number;
}

export interface TerrainOptions {
  maxLevel: number; // finest level (size = ROOT_SIZE / 2^maxLevel)
  splitFactor: number;
  maxCached: number;
  workers: number;
  /** Max view distance: nodes entirely beyond are skipped. */
  farDistance: number;
}

export class TerrainSystem {
  readonly group = new Group();
  private readonly nodes = new Map<string, Node>();
  private readonly index = new BufferAttribute(buildChunkIndices(), 1);
  private readonly workers: Worker[] = [];
  private readonly inFlight = new Map<number, Node>();
  private readonly workerBusy: number[] = [];
  private queue: Node[] = [];
  private nextId = 1;
  private frame = 0;
  private date: string;
  private readonly camPos = new Vector3();
  private readyResolvers: (() => void)[] = [];
  /** Number of chunks currently drawn (for stats). */
  drawnCount = 0;

  constructor(
    private material: Material,
    date: string,
    private opts: TerrainOptions,
  ) {
    this.date = date;
    this.group.name = 'terrain';
    if (typeof Worker !== 'undefined') {
      for (let i = 0; i < opts.workers; i++) {
        try {
          const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
          w.onmessage = (e: MessageEvent<ChunkData>) => this.onChunk(e.data, i);
          w.onerror = (err) => console.error('terrain worker error', err);
          this.workers.push(w);
          this.workerBusy.push(0);
        } catch (err) {
          console.warn('terrain: workers unavailable, building on main thread', err);
          break;
        }
      }
    }
  }

  setDate(date: string): void {
    if (date === this.date) return;
    this.date = date;
    for (const n of this.nodes.values()) this.dropMesh(n);
    this.nodes.clear();
    this.inFlight.clear();
    this.queue = [];
  }

  setMaterial(m: Material): void {
    this.material = m;
    for (const n of this.nodes.values()) if (n.mesh) n.mesh.material = m;
  }

  /** Resolves once the currently selected view has no pending chunks. */
  whenReady(): Promise<void> {
    return new Promise((r) => this.readyResolvers.push(r));
  }

  private getNode(level: number, ix: number, iz: number): Node {
    const key = `${level}:${ix}:${iz}`;
    let n = this.nodes.get(key);
    if (!n) {
      const size = ROOT_SIZE / 2 ** level;
      n = {
        key,
        level,
        ix,
        iz,
        size,
        cx: ROOT_MIN + (ix + 0.5) * size,
        cz: ROOT_MIN + (iz + 0.5) * size,
        mesh: null,
        pending: false,
        lastUsed: 0,
        minY: 0,
        maxY: 200,
      };
      this.nodes.set(key, n);
    }
    return n;
  }

  private distanceTo(n: Node): number {
    const half = n.size / 2;
    const dx = Math.max(0, Math.abs(this.camPos.x - n.cx) - half);
    const dz = Math.max(0, Math.abs(this.camPos.z - n.cz) - half);
    const dy = Math.max(0, this.camPos.y - n.maxY, n.minY - this.camPos.y);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private wantsSplit(n: Node): boolean {
    return n.level < this.opts.maxLevel && this.distanceTo(n) < n.size * this.opts.splitFactor;
  }

  private children(n: Node): Node[] {
    const l = n.level + 1;
    const x = n.ix * 2;
    const z = n.iz * 2;
    return [this.getNode(l, x, z), this.getNode(l, x + 1, z), this.getNode(l, x, z + 1), this.getNode(l, x + 1, z + 1)];
  }

  private request(n: Node): void {
    if (n.mesh || n.pending) return;
    n.pending = true;
    this.queue.push(n);
  }

  /** Whether the subtree under n can be drawn fully at the desired LOD. */
  private covered(n: Node, memo: Map<Node, boolean>): boolean {
    let r = memo.get(n);
    if (r !== undefined) return r;
    if (this.distanceTo(n) > this.opts.farDistance) r = true;
    else if (this.wantsSplit(n)) r = this.children(n).every((c) => this.covered(c, memo));
    else r = n.mesh !== null;
    memo.set(n, r);
    return r;
  }

  private draw(n: Node, memo: Map<Node, boolean>, out: Node[]): void {
    if (this.distanceTo(n) > this.opts.farDistance) return;
    n.lastUsed = this.frame;
    if (this.wantsSplit(n)) {
      const kids = this.children(n);
      kids.forEach((k) => this.request(k));
      if (kids.every((k) => this.covered(k, memo)) || !n.mesh) {
        for (const k of kids) this.draw(k, memo, out);
        return;
      }
      // Children not ready: draw this node in their place, but keep requesting
      // the whole desired subtree so it eventually becomes drawable.
      for (const k of kids) this.prefetch(k);
      out.push(n);
      return;
    }
    this.request(n);
    if (n.mesh) out.push(n);
  }

  private prefetch(n: Node): void {
    if (this.distanceTo(n) > this.opts.farDistance) return;
    n.lastUsed = this.frame;
    this.request(n);
    if (this.wantsSplit(n)) for (const k of this.children(n)) this.prefetch(k);
  }

  update(camera: Camera): void {
    this.frame++;
    camera.getWorldPosition(this.camPos);
    const memo = new Map<Node, boolean>();
    const out: Node[] = [];
    // Root is split into a 4x4 grid of level-2 nodes, which are always requested.
    for (let ix = 0; ix < 4; ix++)
      for (let iz = 0; iz < 4; iz++) {
        const n = this.getNode(2, ix, iz);
        this.request(n);
        this.draw(n, memo, out);
      }
    // Visibility
    const visible = new Set(out);
    for (const n of this.nodes.values()) if (n.mesh) n.mesh.visible = visible.has(n);
    this.drawnCount = out.length;
    this.pump();
    this.evict();
    if (this.readyResolvers.length && this.queue.length === 0 && this.inFlight.size === 0) {
      const rs = this.readyResolvers;
      this.readyResolvers = [];
      rs.forEach((r) => r());
    }
  }

  private pump(): void {
    // Coarse levels first, then nearest.
    this.queue = this.queue.filter((n) => {
      const keep = n.pending && !n.mesh && n.lastUsed >= this.frame - 2;
      if (!keep) n.pending = false;
      return keep;
    });
    this.queue.sort((a, b) => a.level - b.level || this.distanceTo(a) - this.distanceTo(b));
    if (this.workers.length === 0) {
      // Main-thread fallback: a small budget per frame.
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 6) {
        const n = this.queue.shift()!;
        const id = this.nextId++;
        this.inFlight.set(id, n);
        this.onChunk(buildChunk(this.req(n, id)), -1);
      }
      return;
    }
    for (let w = 0; w < this.workers.length && this.queue.length; w++) {
      while (this.workerBusy[w] < 2 && this.queue.length) {
        const n = this.queue.shift()!;
        const id = this.nextId++;
        this.inFlight.set(id, n);
        this.workerBusy[w]++;
        this.workers[w].postMessage(this.req(n, id));
      }
    }
  }

  private req(n: Node, id: number): ChunkRequest {
    return { id, cx: n.cx, cz: n.cz, size: n.size, date: this.date };
  }

  private onChunk(d: ChunkData, worker: number): void {
    if (worker >= 0) this.workerBusy[worker] = Math.max(0, this.workerBusy[worker] - 1);
    const n = this.inFlight.get(d.id);
    this.inFlight.delete(d.id);
    if (!n || this.nodes.get(n.key) !== n) return; // stale (date changed)
    n.pending = false;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new BufferAttribute(d.normals, 3));
    g.setAttribute('aLand', new BufferAttribute(d.land, 4));
    g.setAttribute('aFront', new BufferAttribute(d.front, 1));
    g.setIndex(this.index);
    const half = n.size / 2;
    g.boundingBox = new Box3(new Vector3(-half, d.minY - 300, -half), new Vector3(half, d.maxY, half));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
    const m = new Mesh(g, this.material);
    m.position.set(n.cx, 0, n.cz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    m.visible = false;
    m.name = `terrain:${n.key}`;
    n.mesh = m;
    n.minY = d.minY;
    n.maxY = d.maxY;
    this.group.add(m);
  }

  private dropMesh(n: Node): void {
    if (!n.mesh) return;
    this.group.remove(n.mesh);
    n.mesh.geometry.dispose();
    n.mesh = null;
  }

  private evict(): void {
    if (this.frame % 30 !== 0) return;
    const withMesh = [...this.nodes.values()].filter((n) => n.mesh && n.level > 2);
    if (withMesh.length <= this.opts.maxCached) return;
    withMesh.sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < withMesh.length - this.opts.maxCached; i++) {
      const n = withMesh[i];
      if (n.lastUsed >= this.frame - 1) break;
      this.dropMesh(n);
      this.nodes.delete(n.key);
    }
  }

  get pendingCount(): number {
    return this.queue.length + this.inFlight.size;
  }

  dispose(): void {
    this.workers.forEach((w) => w.terminate());
    for (const n of this.nodes.values()) this.dropMesh(n);
    this.nodes.clear();
  }
}

export { CHUNK_SEGMENTS };
