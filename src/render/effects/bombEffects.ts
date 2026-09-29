/**
 * Bombs in the world (docs/bombers.md): the combat system's bombs as they fall
 * (`CombatSystem.bombs`, drawn where the sim has them, wind drift included), and the
 * craters and scorch marks that `bomb-exploded` leaves on the ground.
 *
 * Falling bombs: a pool of meshes, one per `BombView` in flight, nose along the velocity and
 * sized from the bomb's mass. Views may be pooled objects, so they are matched by index
 * each frame.
 *
 * Craters: one merged mesh for every crater of the mission (one draw call), each a 3×3 grid
 * of vertices draped over the ground heights, with a ring buffer once full.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LatheGeometry,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BombView, WorldQuery } from '../../core/interfaces';
import { AIRCRAFT_LIST, bombDimensions, type BombDimensions } from '../../data/aircraft';
import type { GameEvent } from '../../core/types';

type Exploded = Extract<GameEvent, { type: 'bomb-exploded' }>;

/** Most bombs drawn at once; a raid's later bombs beyond this aren't drawn until some land. */
export const MAX_DRAWN_BOMBS = 96;
const MAX_CRATERS = 128;
/** Vertices per crater (3×3 grid) and indices (8 triangles). */
const CV = 9;
const CI = 24;

/** Rack size of the store a falling bomb came from (the models' table), else by its mass. */
function fallingBombSize(b: BombView, world: WorldQuery): BombDimensions {
  const shooter = world.getEntity?.(b.shooterId);
  const store = shooter?.kind === 'aircraft' ? shooter.spec.bombs?.[b.storeIndex] : undefined;
  if (store && store.massKg === b.massKg) return bombDimensions(store);
  // The releasing aircraft is gone: the first store of that mass in the roster.
  let d = BY_MASS.get(b.massKg);
  if (!d) BY_MASS.set(b.massKg, (d = bombDimensions({ name: '', massKg: b.massKg })));
  return d;
}
const BY_MASS = new Map<number, BombDimensions>();
for (const spec of AIRCRAFT_LIST) for (const st of spec.bombs ?? []) if (!BY_MASS.has(st.massKg)) BY_MASS.set(st.massKg, bombDimensions(st));

/** Crater radius, m, for a charge (about 2.6 m for the P.u.W. 50 kg's 23 kg). */
export function craterRadius(explosiveKg: number): number {
  return 0.9 * Math.cbrt(Math.max(0.1, explosiveKg));
}

let bombGeo: BufferGeometry | null = null;
/** Unit bomb, length 1 along +Z (the nose; `lookAt` turns +Z to the target), 0.15 wide, with cruciform fins. */
function unitBomb(): BufferGeometry {
  if (bombGeo) return bombGeo;
  // Tail to nose, bottom to top, so the lathe's faces wind outward.
  const prof = [
    [0.012, -0.5],
    [0.035, -0.34],
    [0.075, -0.12],
    [0.075, 0.32],
    [0.07, 0.44],
    [0.0, 0.5],
  ].map(([r, y]) => new Vector2(r, y));
  const body = new LatheGeometry(prof, 8).rotateX(Math.PI / 2);
  const f1 = new BoxGeometry(0.2, 0.008, 0.16).translate(0, 0, -0.42);
  const f2 = new BoxGeometry(0.008, 0.2, 0.16).translate(0, 0, -0.42);
  for (const g of [body, f1, f2]) g.deleteAttribute('uv');
  bombGeo = mergeGeometries([body.toNonIndexed(), f1.toNonIndexed(), f2.toNonIndexed()])!;
  bombGeo.computeVertexNormals();
  return bombGeo;
}

function craterTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  // Outer scorch and thrown earth, the pale spoil rim, the dark bowl.
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(28,22,16,0.95)');
  g.addColorStop(0.3, 'rgba(46,36,26,0.92)');
  g.addColorStop(0.42, 'rgba(112,94,70,0.85)');
  g.addColorStop(0.52, 'rgba(78,64,46,0.7)');
  g.addColorStop(0.75, 'rgba(40,34,26,0.35)');
  g.addColorStop(1, 'rgba(40,34,26,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // Clods and splashes of spoil, so no two craters read as a perfect disc.
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 120; i++) {
    const a = r() * Math.PI * 2;
    const d = 22 + r() * 34;
    ctx.fillStyle = `rgba(${70 + r() * 50},${56 + r() * 40},${40 + r() * 30},${0.25 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + r() * 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class BombEffects {
  readonly group = new Group();
  private readonly pool: Mesh[] = [];
  private drawn = 0;
  private readonly exploded: Exploded[] = [];
  private readonly bombMat = new MeshStandardMaterial({ color: 0x55583f, metalness: 0.35, roughness: 0.55 });
  private readonly craterGeo = new BufferGeometry();
  private readonly craterMat: MeshLambertMaterial;
  private readonly craters: Mesh;
  private craterCount = 0;
  private craterNext = 0;
  /** Called for each burst so the particle effects can play it (EffectsSystem.bombBurst). */
  onBurst: ((e: Exploded, groundY: number, water: boolean) => void) | null = null;
  /** Is (x, z) open water (a burst there leaves a plume, no crater)? EffectsSystem sets it from land use. */
  isWater: (x: number, z: number) => boolean = () => false;

  constructor() {
    this.group.name = 'bombs';
    const pos = new Float32Array(MAX_CRATERS * CV * 3);
    const uv = new Float32Array(MAX_CRATERS * CV * 2);
    const idx = new Uint32Array(MAX_CRATERS * CI);
    for (let c = 0; c < MAX_CRATERS; c++) {
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          uv[(c * CV + j * 3 + i) * 2] = i / 2;
          uv[(c * CV + j * 3 + i) * 2 + 1] = j / 2;
        }
      let o = c * CI;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const a = c * CV + j * 3 + i;
          idx.set([a, a + 3, a + 1, a + 1, a + 3, a + 4], o);
          o += 6;
        }
    }
    this.craterGeo.setAttribute('position', new BufferAttribute(pos, 3));
    this.craterGeo.setAttribute('uv', new BufferAttribute(uv, 2));
    const nrm = new Float32Array(MAX_CRATERS * CV * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    this.craterGeo.setAttribute('normal', new BufferAttribute(nrm, 3));
    this.craterGeo.setIndex(new BufferAttribute(idx, 1));
    this.craterGeo.setDrawRange(0, 0);
    this.craterMat = new MeshLambertMaterial({ map: typeof document !== 'undefined' ? craterTexture() : null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.craters = new Mesh(this.craterGeo, this.craterMat);
    this.craters.name = 'BombCraters';
    this.craters.frustumCulled = false;
    this.craters.renderOrder = 1;
    this.group.add(this.craters);
  }

  /** Bombs drawn in the air after the last update. */
  get fallingCount(): number {
    return this.drawn;
  }

  get craterTotal(): number {
    return this.craterCount;
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'bomb-exploded') this.exploded.push(e);
  }

  /** Draw `bombs` (the combat system's bombs in flight; none when absent) and resolve bursts. */
  update(world: WorldQuery, bombs: readonly BombView[] = []): void {
    for (const e of this.exploded.splice(0)) this.burst(e, world);
    const n = Math.min(bombs.length, MAX_DRAWN_BOMBS);
    for (let i = 0; i < n; i++) {
      const b = bombs[i];
      const mesh = this.pool[i] ?? this.addMesh();
      const { lengthM, diameterM } = fallingBombSize(b, world);
      mesh.scale.set(diameterM / 0.15, diameterM / 0.15, lengthM);
      mesh.position.copy(b.position);
      if (b.velocity.lengthSq() > 1e-4) mesh.lookAt(_look.copy(b.position).add(b.velocity));
      mesh.visible = true;
    }
    for (let i = n; i < this.drawn; i++) this.pool[i].visible = false;
    this.drawn = n;
  }

  private addMesh(): Mesh {
    const mesh = new Mesh(unitBomb(), this.bombMat);
    mesh.name = 'FallingBomb';
    mesh.castShadow = true;
    this.pool.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private burst(e: Exploded, world: WorldQuery): void {
    const gy = world.groundHeightAt(e.position.x, e.position.z);
    const water = this.isWater(e.position.x, e.position.z);
    this.onBurst?.(e, gy, water);
    if (!water) this.addCrater(e.position.x, e.position.z, craterRadius(e.explosiveKg) * 2.2, world);
  }

  /** Drape a crater decal of half-size `h` over the ground at (x, z). */
  addCrater(x: number, z: number, h: number, world: Pick<WorldQuery, 'groundHeightAt'>): void {
    const c = this.craterNext;
    this.craterNext = (c + 1) % MAX_CRATERS;
    this.craterCount = Math.min(MAX_CRATERS, this.craterCount + 1);
    const pos = this.craterGeo.getAttribute('position') as BufferAttribute;
    const rot = ((x * 12.9898 + z * 78.233) % 1) * Math.PI * 2;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const u = (i - 1) * h;
        const v = (j - 1) * h;
        const px = x + u * cs - v * sn;
        const pz = z + u * sn + v * cs;
        pos.setXYZ(c * CV + j * 3 + i, px, world.groundHeightAt(px, pz) + 0.25, pz);
      }
    pos.needsUpdate = true;
    this.craterGeo.setDrawRange(0, this.craterCount * CI);
  }

  /** Clear the falling bombs and craters (a new mission). */
  clear(): void {
    for (const m of this.pool) m.visible = false;
    this.drawn = 0;
    this.exploded.length = 0;
    this.craterCount = this.craterNext = 0;
    this.craterGeo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.clear();
    for (const m of this.pool) m.removeFromParent();
    this.pool.length = 0;
    this.craterGeo.dispose();
    this.craterMat.map?.dispose();
    this.craterMat.dispose();
    this.bombMat.dispose();
  }
}

const _look = new Vector3();
