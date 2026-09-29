/**
 * Bombs in the world (docs/bombers.md): bombs falling from the racks after a `bomb-released`
 * event, and the craters and scorch marks that `bomb-exploded` leaves on the ground.
 *
 * Falling bombs: combat has no bomb view yet, so each one is drawn from the release event on
 * a ballistic path of its own (the releasing aircraft's velocity, gravity and a little drag).
 * It lands close to where the sim's bomb does; a matching `bomb-exploded` removes it early.
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
import type { WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, BombStore, GameEvent } from '../../core/types';

type Released = Extract<GameEvent, { type: 'bomb-released' }>;
type Exploded = Extract<GameEvent, { type: 'bomb-exploded' }>;

const G = 9.81;
const RHO = 1.1;
const MAX_FALLING = 48;
const MAX_CRATERS = 128;
/** Vertices per crater (3×3 grid) and indices (8 triangles). */
const CV = 9;
const CI = 24;

/** Size of a bomb from its mass: diameter and length, m (the 50 kg P.u.W. is 1.7 m × 0.18 m). */
export function bombSize(massKg: number): { diameter: number; length: number } {
  const diameter = 0.05 * Math.cbrt(massKg);
  return { diameter, length: diameter * 7 };
}

/** Crater radius, m, for a charge (about 2.6 m for the P.u.W. 50 kg's 23 kg). */
export function craterRadius(explosiveKg: number): number {
  return 0.9 * Math.cbrt(Math.max(0.1, explosiveKg));
}

/**
 * Per-second drag factor k for dv/dt = -k·|v|·v: a streamlined bomb (Cd 0.3) of the given
 * mass. Heavy bombs fall almost as in vacuum; the small ones slow a little.
 */
export function bombDragK(massKg: number): number {
  const d = bombSize(massKg).diameter;
  return (0.5 * RHO * 0.3 * Math.PI * d * d * 0.25) / massKg;
}

/** Advance a falling bomb one step (semi-implicit Euler). */
export function stepBomb(pos: Vector3, vel: Vector3, k: number, dt: number): void {
  const s = vel.length();
  vel.x -= k * s * vel.x * dt;
  vel.z -= k * s * vel.z * dt;
  vel.y -= (G + k * s * vel.y) * dt;
  pos.addScaledVector(vel, dt);
}

interface Falling {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  k: number;
  shooter: number;
  age: number;
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
  private readonly falling: Falling[] = [];
  private readonly released: Released[] = [];
  private readonly exploded: Exploded[] = [];
  private readonly bombMat = new MeshStandardMaterial({ color: 0x55583f, metalness: 0.35, roughness: 0.55 });
  private readonly craterGeo = new BufferGeometry();
  private readonly craterMat: MeshLambertMaterial;
  private readonly craters: Mesh;
  private craterCount = 0;
  private craterNext = 0;
  /** Called for each burst so the particle effects can play it (EffectsSystem.bombBurst). */
  onBurst: ((e: Exploded, groundY: number, water: boolean) => void) | null = null;

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

  get fallingCount(): number {
    return this.falling.length;
  }

  get craterTotal(): number {
    return this.craterCount;
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'bomb-released') this.released.push(e);
    else if (e.type === 'bomb-exploded') this.exploded.push(e);
  }

  update(dt: number, world: WorldQuery): void {
    for (const e of this.released.splice(0)) this.launch(e, world);
    for (const e of this.exploded.splice(0)) this.burst(e, world);
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const b = this.falling[i];
      b.age += dt;
      stepBomb(b.pos, b.vel, b.k, dt);
      const ground = world.groundHeightAt(b.pos.x, b.pos.z);
      if (b.pos.y <= ground || b.age > 90) {
        this.remove(i);
        continue;
      }
      b.mesh.position.copy(b.pos);
      b.mesh.lookAt(_look.copy(b.pos).add(b.vel));
    }
  }

  private launch(e: Released, world: WorldQuery): void {
    const ac = world.getEntity(e.aircraftId) as AircraftEntity | undefined;
    const store: BombStore | undefined = ac?.kind === 'aircraft' ? ac.spec.bombs?.[e.storeIndex] : undefined;
    const mass = store?.massKg ?? 50;
    if (this.falling.length >= MAX_FALLING) this.remove(0);
    const { diameter, length } = bombSize(mass);
    const mesh = new Mesh(unitBomb(), this.bombMat);
    mesh.scale.set(diameter / 0.15, diameter / 0.15, length);
    mesh.castShadow = true;
    const vel = ac?.kind === 'aircraft' ? ac.state.velocity.clone() : new Vector3();
    const pos = e.position.clone();
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.falling.push({ mesh, pos, vel, k: bombDragK(mass), shooter: e.aircraftId, age: 0 });
  }

  private burst(e: Exploded, world: WorldQuery): void {
    // The sim's bomb has landed: take ours (the nearest of that aircraft's) out of the air.
    let best = -1;
    let bestD = 60 * 60;
    this.falling.forEach((b, i) => {
      const d = b.pos.distanceToSquared(e.position);
      if (b.shooter === e.shooterId && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) this.remove(best);
    const gy = world.groundHeightAt(e.position.x, e.position.z);
    const water = gy <= 0.05 && e.position.y <= 0.5;
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

  private remove(i: number): void {
    const [b] = this.falling.splice(i, 1);
    b.mesh.removeFromParent();
  }

  /** Clear the falling bombs and craters (a new mission). */
  clear(): void {
    while (this.falling.length) this.remove(0);
    this.released.length = this.exploded.length = 0;
    this.craterCount = this.craterNext = 0;
    this.craterGeo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.clear();
    this.craterGeo.dispose();
    this.craterMat.map?.dispose();
    this.craterMat.dispose();
    this.bombMat.dispose();
  }
}

const _look = new Vector3();
