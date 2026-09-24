/**
 * Road surfaces at true width near the camera, draped on the terrain.
 * Geometry is built lazily per ~1 km piece when it first comes into range;
 * farther roads are carried by the terrain shader's feature mask.
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { roadNetwork } from '../world/roads';
import { terrainHeightAt } from '../world/terrain';
import type { Pt } from '../world/segmentIndex';

const PIECE = 1000;
const SHOW = 2200;
const STEP = 12;

interface Piece {
  pts: Pt[];
  width: number;
  cx: number;
  cz: number;
  radius: number;
  mesh: Mesh | null;
}

export class RoadRibbons {
  readonly group = new Group();
  private readonly pieces: Piece[] = [];
  private readonly material = new MeshStandardMaterial({
    color: 0x8f8672,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  constructor() {
    this.group.name = 'roads';
    for (const r of roadNetwork()) {
      // Resample along the road at STEP spacing, split into pieces.
      let cur: Pt[] = [];
      let acc = 0;
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.ceil(len / STEP));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          cur.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          acc += len / n;
          if (acc >= PIECE) {
            this.addPiece(cur, r.width);
            cur = [cur[cur.length - 1]];
            acc = 0;
          }
        }
      }
      cur.push(r.points[r.points.length - 1]);
      this.addPiece(cur, r.width);
    }
  }

  private addPiece(pts: Pt[], width: number): void {
    if (pts.length < 2) return;
    const cx = (pts[0].x + pts[pts.length - 1].x) / 2;
    const cz = (pts[0].z + pts[pts.length - 1].z) / 2;
    const radius = Math.hypot(pts[0].x - cx, pts[0].z - cz) + 50;
    this.pieces.push({ pts, width, cx, cz, radius, mesh: null });
  }

  private build(p: Piece): Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = p.width / 2;
    const pts = p.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const x1 = pts[i].x + nx * hw, z1 = pts[i].z + nz * hw;
      const x2 = pts[i].x - nx * hw, z2 = pts[i].z - nz * hw;
      pos.push(x1 - p.cx, terrainHeightAt(x1, z1) + 0.12, z1 - p.cz, x2 - p.cx, terrainHeightAt(x2, z2) + 0.12, z2 - p.cz);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(g, this.material);
    m.position.set(p.cx, 0, p.cz);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  update(cam: Vector3): void {
    let built = 0;
    for (const p of this.pieces) {
      const d = Math.hypot(p.cx - cam.x, p.cz - cam.z) - p.radius;
      const want = d < SHOW && cam.y < 2500;
      if (want && !p.mesh && built < 6) {
        p.mesh = this.build(p);
        built++;
      }
      if (p.mesh) p.mesh.visible = want;
    }
  }
}
