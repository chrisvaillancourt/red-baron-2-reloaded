/**
 * AircraftVisual implementation (src/core/interfaces.ts): a cloned GLB (or
 * fallback) with per-instance livery materials, propeller + control-surface
 * animation, cockpit gauges, muzzle flashes and damage visuals.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { AircraftVisual, AircraftVisualFactory } from '../../core/interfaces';
import type { AircraftEntity, AircraftSpec, DamageZone, Livery } from '../../core/types';
import { createGaugeSet, GAUGE_KINDS, type GaugeKind, type GaugeSet } from './gauges';
import { getLiveryTextures, type LiveryTextures } from './livery';
import { controlSurfaceAngles, metaFromUserData, type AircraftMeta } from './meta';
import { loadTemplate } from './modelLoader';

// ---------------------------------------------------------------------------
// Shared (non-livery) materials and textures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ground bounce: sunlight reflected off the fields onto down-facing surfaces
// (wing undersides seen from the cockpit). The scene's sky environment map is
// dim below the horizon, which left undersides near-black. One shared uniform,
// driven from the scene's sun, feeds every aircraft material.
// ---------------------------------------------------------------------------

const GROUND_BOUNCE = { value: new Color(0.3, 0.32, 0.26) };
const GROUND_ALBEDO = new Color(0.2, 0.22, 0.16);
let bounceScene: Object3D | null = null;
let bounceSun: DirectionalLight | null = null;
let bounceStamp = -1;

function patchGroundBounce(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundBounce = GROUND_BOUNCE;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGroundBounce;')
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse )
  { vec3 wN = inverseTransformDirection( normal, viewMatrix ); irradiance += uGroundBounce * clamp( 0.5 - 0.5 * wN.y, 0.0, 1.0 ); }
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'rb2-ground-bounce';
}

/** Track the scene's sun (once per frame, shared by all visuals). */
function updateGroundBounce(scene: Object3D | null): void {
  const now = performance.now();
  if (now - bounceStamp < 4 || !scene) return;
  bounceStamp = now;
  if (scene !== bounceScene || !bounceSun || bounceSun.parent !== scene) {
    bounceScene = scene;
    bounceSun = null;
    for (const c of scene.children) if ((c as DirectionalLight).isDirectionalLight) bounceSun = c as DirectionalLight;
  }
  const sun = bounceSun;
  if (!sun) return;
  const dir = _sunDir.copy(sun.position).sub(sun.target.position).normalize();
  const e = sun.intensity * Math.max(0.15, dir.y) + 0.35; // direct + a little skylight on the fields
  GROUND_BOUNCE.value.copy(GROUND_ALBEDO).multiply(sun.color).multiplyScalar(e);
}
const _sunDir = new Vector3();

let shared: Record<string, Material> | null = null;
function sharedMaterials(): Record<string, Material> {
  if (shared) return shared;
  const woodTex = woodTexture();
  shared = {
    // Gunmetal: moderately metallic so it still reads under a dim sky env map (0.85 went black).
    Metal: new MeshStandardMaterial({ color: 0x4c4c48, metalness: 0.55, roughness: 0.5, name: 'Metal' }),
    Wood: new MeshStandardMaterial({ color: 0xffffff, map: woodTex, metalness: 0, roughness: 0.5, name: 'Wood' }),
    Rubber: new MeshStandardMaterial({ color: 0x151412, roughness: 0.92, name: 'Rubber' }),
    Pilot: new MeshStandardMaterial({ color: 0x4a2f1d, roughness: 0.62, name: 'Pilot' }),
    Skin: new MeshStandardMaterial({ color: 0xc99577, roughness: 0.6, name: 'Skin' }),
    Leather: new MeshStandardMaterial({ color: 0x3a2416, roughness: 0.6, side: DoubleSide, name: 'Leather' }),
    Glass: new MeshStandardMaterial({ color: 0x9fc7d8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, name: 'Glass' }),
    Cloth: new MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9, name: 'Cloth' }),
    Gauge: new MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.4, name: 'Gauge' }),
  };
  for (const m of Object.values(shared)) patchGroundBounce(m as MeshStandardMaterial);
  return shared;
}

function woodTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#6e4526';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = i % 3 ? 'rgba(40,20,8,0.25)' : 'rgba(160,110,60,0.25)';
    ctx.lineWidth = 1 + (i % 4);
    ctx.beginPath();
    const x = (i * 37) % 64;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 6, 80, x - 6, 170, x + 3, 256);
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let flashTex: Texture | null = null;
function muzzleFlashTexture(): Texture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,230,160,0.9)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(32, 32);
    ctx.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    ctx.stroke();
  }
  flashTex = new CanvasTexture(c);
  flashTex.colorSpace = SRGBColorSpace;
  return flashTex;
}

let discTex: Texture | null = null;
function propDiscTexture(): Texture {
  if (discTex) return discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(60,40,25,0.0)');
  g.addColorStop(0.12, 'rgba(60,40,25,0.5)');
  g.addColorStop(0.55, 'rgba(90,60,35,0.35)');
  g.addColorStop(0.9, 'rgba(110,80,50,0.5)');
  g.addColorStop(0.97, 'rgba(200,190,170,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // two faint blade "ghosts"
  ctx.fillStyle = 'rgba(40,25,15,0.18)';
  ctx.beginPath();
  ctx.ellipse(128, 128, 14, 124, 0.3, 0, Math.PI * 2);
  ctx.fill();
  discTex = new CanvasTexture(c);
  discTex.colorSpace = SRGBColorSpace;
  return discTex;
}

// ---------------------------------------------------------------------------
// Part -> damage zone mapping (by node name)
// ---------------------------------------------------------------------------

type ZoneGroup = 'leftWing' | 'rightWing' | 'tail' | 'fuselage' | 'engine';

function zoneOf(obj: Object3D): ZoneGroup {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    const n = o.name;
    if (/^(Wing_.*_L|Aileron_L)/.test(n)) return 'leftWing';
    if (/^(Wing_.*_R|Aileron_R)/.test(n)) return 'rightWing';
    if (/^(Stabilizer|Elevator|Fin|Rudder)/.test(n)) return 'tail';
    if (/^(Cowling|Engine|Firewall|Propeller)/.test(n)) return 'engine';
  }
  return 'fuselage';
}

const LIVERY_MAT: Record<string, keyof LiveryTextures | 'accent'> = {
  Livery_Fuselage: 'fuselage',
  Livery_WingTop: 'wingTop',
  Livery_WingBottom: 'wingBottom',
  Livery_Tail: 'tail',
  Livery_Cowling: 'cowling',
  Livery_Accent: 'accent',
};

const CHAR = new Color(0x2a2018);
const WHITE = new Color(0xffffff);

interface Debris {
  obj: Object3D;
  vel: Vector3;
  spin: Vector3;
  life: number;
}

const MAX_HOLES = 160;
const HOLES_PER_PART = 40;
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

class AircraftVisualImpl implements AircraftVisual {
  readonly object: Object3D;
  readonly eyePoint = new Vector3();
  /** Body-frame ground contact points (wheel bottoms, tail-skid tip). */
  readonly contactPoints: { wheelL: Vector3; wheelR: Vector3; skid: Vector3 };
  readonly meta: AircraftMeta;

  private readonly spec: AircraftSpec;
  private readonly prop: Object3D | null;
  private readonly blades: Object3D | null;
  private readonly disc: Mesh;
  private readonly surfaces: Partial<Record<'aileronL' | 'aileronR' | 'elevator' | 'rudder', Object3D>> = {};
  private readonly pilot: Object3D | null;
  private readonly flexGun: Object3D | null;
  private readonly muzzles: { node: Object3D; sprite: Sprite; lastRounds: number; flash: number }[] = [];
  private readonly zoneMats = new Map<ZoneGroup, MeshStandardMaterial[]>();
  private readonly zoneMeshes = new Map<ZoneGroup, Mesh[]>();
  private readonly holeMat: MeshBasicMaterial;
  private readonly holeMeshes = new Map<Mesh, Mesh>();
  private holeCount = 0;
  private readonly zoneHoleLevel: Record<ZoneGroup, number> = { leftWing: 0, rightWing: 0, tail: 0, fuselage: 0, engine: 0 };
  private readonly debris: Debris[] = [];
  private detached = new Set<string>();
  private gauges: GaugeSet | null = null;
  private gaugeTimer = 0;
  private cockpit = false;
  private propAngle = 0;
  private readonly ownedMaterials: Material[] = [];
  private flexAim: Vector3 | null = null;

  constructor(template: Object3D, spec: AircraftSpec, livery: Livery) {
    this.spec = spec;
    const root = template.clone(true);
    this.object = root;
    root.name = `Aircraft_${spec.id}`;
    this.meta = metaFromUserData(template.userData, spec.geometry);
    root.userData = { ...template.userData };
    const tex = getLiveryTextures(spec, livery, this.meta);
    const sm = sharedMaterials();

    // Per-instance livery materials, split by damage zone so each zone can char independently.
    const cache = new Map<string, MeshStandardMaterial>();
    const liveryMat = (name: string, zone: ZoneGroup): MeshStandardMaterial => {
      const key = `${name}|${zone}`;
      let m = cache.get(key);
      if (m) return m;
      const slot = LIVERY_MAT[name];
      if (slot === 'accent') {
        m = new MeshStandardMaterial({ color: new Color(livery.accent), roughness: 0.5, metalness: 0.1 });
      } else {
        const ply = slot === 'fuselage' && spec.geometry.fuselageShape === 'plywood-oval';
        m = new MeshStandardMaterial({
          map: tex[slot],
          roughness: slot === 'cowling' ? 0.38 : ply ? 0.5 : 0.8,
          metalness: slot === 'cowling' ? 0.45 : 0,
        });
        if (slot === 'fuselage' || slot === 'tail' || slot === 'cowling') m.side = DoubleSide;
      }
      m.name = name;
      patchGroundBounce(m);
      cache.set(key, m);
      this.ownedMaterials.push(m);
      const list = this.zoneMats.get(zone) ?? [];
      list.push(m);
      this.zoneMats.set(zone, list);
      return m;
    };

    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const zone = zoneOf(mesh);
      const swap = (m: Material): Material => {
        const n = m.name.replace(/\.\d+$/, '');
        if (n in LIVERY_MAT) return liveryMat(n, zone);
        return sm[n] ?? m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const zm = this.zoneMeshes.get(zone) ?? [];
      if (!/^(Aileron|Elevator|Rudder|Propeller|PropBlades|RotaryEngine)/.test(mesh.name) && !/Gauge|Pilot|Gunner|Cockpit/.test(mesh.name)) zm.push(mesh);
      this.zoneMeshes.set(zone, zm);
    });

    this.prop = root.getObjectByName('Propeller') ?? null;
    this.blades = root.getObjectByName('PropBlades') ?? null;
    this.surfaces.aileronL = root.getObjectByName('Aileron_L');
    this.surfaces.aileronR = root.getObjectByName('Aileron_R');
    this.surfaces.elevator = root.getObjectByName('Elevator');
    this.surfaces.rudder = root.getObjectByName('Rudder');
    this.pilot = root.getObjectByName('Pilot') ?? null;
    this.flexGun = root.getObjectByName('Gun_Flexible') ?? null;

    const eye = root.getObjectByName('EyePoint');
    if (eye) this.eyePoint.copy(eye.position);
    else this.eyePoint.set(0, 0.8, 0.4);
    const cp = (n: string, d: Vector3) => root.getObjectByName(n)?.position.clone() ?? d;
    this.contactPoints = {
      wheelL: cp('Contact_WheelL', new Vector3(-0.8, -1.1, -0.5)),
      wheelR: cp('Contact_WheelR', new Vector3(0.8, -1.1, -0.5)),
      skid: cp('Contact_Skid', new Vector3(0, -0.3, 4)),
    };

    // Propeller disc (blurred arc at speed).
    const discMat = new MeshBasicMaterial({ map: propDiscTexture(), transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 });
    this.ownedMaterials.push(discMat);
    this.disc = new Mesh(new CircleGeometry(this.meta.prop_radius, 40), discMat);
    this.disc.name = 'PropDisc';
    this.disc.renderOrder = 2;
    (this.prop ?? root).add(this.disc);

    // Muzzle flashes
    spec.guns.forEach((_g, i) => {
      const node = root.getObjectByName(`Muzzle_${i}`);
      if (!node) return;
      const mat = new SpriteMaterial({ map: muzzleFlashTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true });
      this.ownedMaterials.push(mat);
      const sprite = new Sprite(mat);
      sprite.scale.setScalar(0.45);
      sprite.visible = false;
      node.add(sprite);
      this.muzzles.push({ node, sprite, lastRounds: -1, flash: 0 });
    });

    // Bullet-hole decals
    this.holeMat = new MeshBasicMaterial({ color: 0x0d0b09, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide });
    this.ownedMaterials.push(this.holeMat);
  }

  update(ac: AircraftEntity, dt: number): void {
    const o = this.object;
    o.position.copy(ac.state.position);
    o.quaternion.copy(ac.state.orientation);
    updateGroundBounce(o.parent);

    // Propeller: rotary engines spin the whole cylinder block with it.
    const rpm = ac.damage.engineDead ? Math.max(0, ac.state.engineRpm) : ac.state.engineRpm;
    this.propAngle = (this.propAngle + (rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    if (this.prop) this.prop.rotation.z = this.pusherSign() * this.propAngle;
    const blur = smooth(250, 800, rpm);
    const discMat = this.disc.material as MeshBasicMaterial;
    discMat.opacity = blur * (this.cockpit ? 0.1 : 0.75); // from the seat the blur is a faint shimmer
    this.disc.visible = blur > 0.01;
    if (this.blades) this.blades.visible = rpm < 700 || this.detached.has('prop');

    // Control surfaces
    const a = controlSurfaceAngles(ac.controls);
    if (this.surfaces.aileronL) this.surfaces.aileronL.rotation.x = a.aileronL;
    if (this.surfaces.aileronR) this.surfaces.aileronR.rotation.x = a.aileronR;
    if (this.surfaces.elevator) this.surfaces.elevator.rotation.x = a.elevator;
    if (this.surfaces.rudder) this.surfaces.rudder.rotation.y = a.rudder;

    // Flexible gun aim (optional, set by the integrator)
    if (this.flexGun && this.flexAim) {
      const local = this.object.worldToLocal(this.flexAim.clone()).sub(this.flexGun.position);
      const yaw = Math.atan2(-local.x, -local.z);
      const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
      this.flexGun.rotation.set(0, 0, 0);
      this.flexGun.rotateY(yaw);
      this.flexGun.rotateX(Math.max(-0.3, Math.min(1.2, pitch)));
    }

    // Muzzle flashes: detect rounds consumed since the last frame.
    for (let i = 0; i < this.muzzles.length; i++) {
      const m = this.muzzles[i];
      const g = ac.guns[i];
      if (!g) continue;
      if (m.lastRounds >= 0 && g.roundsLeft < m.lastRounds) m.flash = 0.06;
      m.lastRounds = g.roundsLeft;
      m.flash -= dt;
      m.sprite.visible = m.flash > 0 && Math.random() > 0.25;
      if (m.sprite.visible) {
        m.sprite.scale.setScalar((0.3 + Math.random() * 0.3) * (this.cockpit ? 0.4 : 1));
        m.sprite.material.rotation = Math.random() * Math.PI;
      }
    }

    this.updateDamage(ac, dt);

    if (this.cockpit && this.gauges) {
      this.gaugeTimer -= dt;
      if (this.gaugeTimer <= 0) {
        this.gaugeTimer = 0.1;
        this.gauges.draw(ac);
      }
    }
  }

  private pusherSign(): number {
    return this.spec.geometry.pusher ? -1 : 1;
  }

  private updateDamage(ac: AircraftEntity, dt: number): void {
    const z = ac.damage.zones;
    const level: Record<ZoneGroup, number> = {
      leftWing: z.leftWing,
      rightWing: z.rightWing,
      tail: Math.max(z.tail, z.controls * 0.5),
      fuselage: Math.max(z.fuselage, z.pilot * 0.3, z.fuelTank * 0.5),
      engine: z.engine,
    };
    const burning = ac.damage.onFire || ac.damage.destroyed;
    for (const [zone, mats] of this.zoneMats) {
      const d = Math.min(1, level[zone] * 0.55 + (burning ? 0.45 : 0));
      for (const m of mats) m.color.copy(WHITE).lerp(CHAR, d);
    }
    // Holes: add a few per 4% of new damage in a zone.
    for (const zone of Object.keys(level) as ZoneGroup[]) {
      const target = Math.floor(level[zone] * 25);
      while (this.zoneHoleLevel[zone] < target && this.holeCount < MAX_HOLES) {
        this.zoneHoleLevel[zone]++;
        for (let k = 0; k < 3; k++) this.addHole(zone);
      }
    }
    if (ac.damage.structuralFailure) this.breakApart(ac);
    // Debris physics
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.vel.y -= 9.81 * dt;
      d.vel.multiplyScalar(1 - 0.35 * dt);
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      d.life -= dt;
      if (d.life <= 0) {
        d.obj.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
  }

  private addHole(zone: ZoneGroup): void {
    const meshes = this.zoneMeshes.get(zone);
    if (!meshes || meshes.length === 0) return;
    const mesh = meshes[Math.floor(Math.random() * meshes.length)];
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    if (triCount < 1) return;
    const t = Math.floor(Math.random() * triCount);
    const vi = (k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const a = new Vector3().fromBufferAttribute(pos, vi(0));
    const b = new Vector3().fromBufferAttribute(pos, vi(1));
    const c = new Vector3().fromBufferAttribute(pos, vi(2));
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    // Decals live in the part's own space so they follow detached/animated parts.
    let decal = this.holeMeshes.get(mesh);
    if (!decal) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(new Float32Array(HOLES_PER_PART * 18 * 3), 3));
      g.setDrawRange(0, 0);
      decal = new Mesh(g, this.holeMat);
      decal.name = 'BulletHoles';
      decal.frustumCulled = false;
      mesh.add(decal);
      this.holeMeshes.set(mesh, decal);
    }
    const g = decal.geometry;
    const used = g.drawRange.count / 18;
    if (used >= HOLES_PER_PART) return;
    const attr = g.getAttribute('position') as Float32BufferAttribute;
    const e1 = new Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? UP : RIGHT).normalize();
    const e2 = new Vector3().crossVectors(n, e1);
    const r = 0.018 + Math.random() * 0.03;
    p.addScaledVector(n, 0.003);
    const q = new Vector3();
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
      const base = (used * 18 + k * 3) * 3;
      attr.array[base] = p.x; attr.array[base + 1] = p.y; attr.array[base + 2] = p.z;
      q.copy(p).addScaledVector(e1, Math.cos(a0) * r).addScaledVector(e2, Math.sin(a0) * r * (0.7 + Math.random() * 0.6));
      attr.array[base + 3] = q.x; attr.array[base + 4] = q.y; attr.array[base + 5] = q.z;
      q.copy(p).addScaledVector(e1, Math.cos(a1) * r).addScaledVector(e2, Math.sin(a1) * r);
      attr.array[base + 6] = q.x; attr.array[base + 7] = q.y; attr.array[base + 8] = q.z;
    }
    attr.needsUpdate = true;
    g.setDrawRange(0, (used + 1) * 18);
    this.holeCount++;
  }

  private breakApart(ac: AircraftEntity): void {
    const z = ac.damage.zones;
    let part: 'leftWing' | 'rightWing' | 'tail' = 'tail';
    if (z.leftWing >= z.rightWing && z.leftWing >= z.tail) part = 'leftWing';
    else if (z.rightWing > z.leftWing && z.rightWing >= z.tail) part = 'rightWing';
    if (this.detached.has(part)) return;
    this.detached.add(part);
    const scene = this.object.parent;
    if (!scene) return;
    const names = part === 'tail' ? /^(Stabilizer|Elevator|Fin|Rudder)/ : part === 'leftWing' ? /^(Wing_(Upper|Main|Middle)_L|Aileron_L)/ : /^(Wing_(Upper|Main|Middle)_R|Aileron_R)/;
    const parts: Object3D[] = [];
    this.object.traverse((o) => {
      if (names.test(o.name) && !parts.some((p) => isAncestor(p, o))) parts.push(o);
    });
    this.object.updateMatrixWorld(true);
    const baseVel = ac.state.velocity.clone();
    for (const p of parts) {
      scene.attach(p);
      this.debris.push({
        obj: p,
        vel: baseVel.clone().multiplyScalar(0.85).add(new Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 4, (Math.random() - 0.5) * 8)),
        spin: new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        life: 25,
      });
    }
  }

  /** Point the rear gunner's weapon at a world position (null = stow). */
  aimFlexibleGun(worldTarget: Vector3 | null): void {
    this.flexAim = worldTarget ? worldTarget.clone() : null;
    if (!worldTarget && this.flexGun) this.flexGun.rotation.set(0, 0, 0);
  }

  setCockpitView(enabled: boolean): void {
    this.cockpit = enabled;
    if (this.pilot) this.pilot.visible = !enabled;
    if (enabled && !this.gauges) {
      this.gauges = createGaugeSet(this.spec.nation, this.spec.performance.engineType === 'rotary', this.spec.performance.fuelCapacityL);
      const gs = this.gauges;
      this.object.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && (GAUGE_KINDS as string[]).includes(mesh.name)) mesh.material = gs.materials[mesh.name as GaugeKind];
      });
      this.gaugeTimer = 0;
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const d of this.debris) d.obj.removeFromParent();
    this.debris.length = 0;
    this.gauges?.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.disc.geometry.dispose();
    for (const d of this.holeMeshes.values()) d.geometry.dispose();
  }
}

function isAncestor(a: Object3D, b: Object3D): boolean {
  for (let o: Object3D | null = b.parent; o; o = o.parent) if (o === a) return true;
  return false;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export type { AircraftVisualImpl };
export type AircraftVisualExt = AircraftVisual & {
  readonly contactPoints: { wheelL: Vector3; wheelR: Vector3; skid: Vector3 };
  readonly meta: AircraftMeta;
  aimFlexibleGun(worldTarget: Vector3 | null): void;
};

/** Factory matching AircraftVisualFactory; resolves to the extended visual. */
export async function createAircraftVisual(spec: AircraftSpec, livery: Livery): Promise<AircraftVisualExt> {
  const template = await loadTemplate(spec);
  return new AircraftVisualImpl(template, spec, livery);
}

// Compile-time check that the factory satisfies the shared contract.
const _factoryCheck: AircraftVisualFactory = createAircraftVisual;
void _factoryCheck;

/** Damage zones rendered by the visual (for docs/tests). */
export const VISUAL_DAMAGE_ZONES: DamageZone[] = ['leftWing', 'rightWing', 'tail', 'fuselage', 'engine'];
