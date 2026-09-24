/**
 * River/canal water ribbons at true width, drawn near the camera where the
 * terrain LOD resolves the flat valley floor. Farther away the terrain
 * shader's feature mask carries the water.
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { riverPolylines } from '../world/terrain';

const PIECE = 1500; // metres of river per mesh
const SHOW_DIST = 5000;

interface Piece {
  mesh: Mesh;
  cx: number;
  cz: number;
  radius: number;
}

export class RiverRibbons {
  readonly group = new Group();
  private readonly pieces: Piece[] = [];
  private readonly material = new MeshStandardMaterial({
    color: 0x1b2a2e,
    roughness: 0.06,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  constructor() {
    this.group.name = 'rivers';
    for (const r of riverPolylines()) {
      const pts = r.points;
      // Arc-length split into pieces.
      let start = 0;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        if (acc >= PIECE || i === pts.length - 1) {
          this.addPiece(pts.slice(start, i + 1), r.floor.slice(start, i + 1), r.width);
          start = i;
          acc = 0;
        }
      }
    }
  }

  private addPiece(pts: { x: number; z: number }[], floor: number[], width: number): void {
    if (pts.length < 2) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = width / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const y = floor[i] + 0.15;
      pos.push(pts[i].x + nx * hw - cx, y, pts[i].z + nz * hw - cz, pts[i].x - nx * hw - cx, y, pts[i].z - nz * hw - cz);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Normals should be straight up (flat water).
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    g.computeBoundingSphere();
    const m = new Mesh(g, this.material);
    m.position.set(cx, 0, cz);
    m.visible = false;
    this.group.add(m);
    this.pieces.push({ mesh: m, cx, cz, radius: g.boundingSphere!.radius });
  }

  update(cam: Vector3): void {
    const agl = cam.y;
    for (const p of this.pieces) {
      const d = Math.hypot(p.cx - cam.x, p.cz - cam.z) - p.radius;
      p.mesh.visible = d < SHOW_DIST && agl < 3500;
    }
  }
}
