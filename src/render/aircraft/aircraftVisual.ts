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
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { AircraftVisual, AircraftVisualFactory } from '../../core/interfaces';
import type { AircraftEntity, AircraftSpec, CrewStationId, DamageZone, FireArc, Livery } from '../../core/types';
import { crewStations } from '../../data/crew';
import { getStationAim } from '../../sim/combat';
import { gunPitchLimits } from './gunAim';
import { propSpinSign, type PropNode } from './propSpin';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGaugeSet, GAUGE_KINDS, type GaugeKind, type GaugeSet } from './gauges';
import { getLiveryTextures, type LiveryTextures } from './livery';
import { controlSurfaceAngles, metaFromUserData, type AircraftMeta } from './meta';
import { loadTemplate } from './modelLoader';
import { createSpotDot } from './spotDot';

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
    Bomb: new MeshStandardMaterial({ color: 0x55583f, metalness: 0.35, roughness: 0.55, name: 'Bomb' }),
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
const _aim = new Vector3();
const _invQ = new Quaternion();
const RAD_TO_DEG = 180 / Math.PI;
const RIGHT = new Vector3(1, 0, 0);

/** One propeller: pivot, blades and its blur disc. Twins have two (`Propeller_L`, `Propeller_R`). */
interface PropView {
  pivot: Object3D;
  blades: Object3D | null;
  disc: Mesh;
  /** Index into `DamageState.engines`. */
  engine: number;
  /** Spin sign: handed twins turn opposite ways, pushers backwards. */
  sign: number;
  angle: number;
}

/** A station's gun mounts (`Gun_<station>`, `Gun_<station>_2`...) and where they rest. */
interface StationGuns {
  pivots: Object3D[];
  /** The station's fields of fire, which bound how far the guns pitch (gunPitchLimits). */
  arcs: readonly FireArc[];
  /** Rest pose: yaw and pitch (rad) the guns are stowed at until aimed. */
  stowYaw: number;
  stowPitch: number;
  /** Laid by the sim's gunner last frame (getStationAim), so stow when he goes idle. */
  simAimed: boolean;
}

/** A bomb store's merged meshes: bomb k is index range [k·n, (k+1)·n); draw the first `remaining`. */
interface BombStoreView {
  mesh: Mesh;
  perBomb: number;
  count: number;
  shown: number;
}

class AircraftVisualImpl implements AircraftVisual {
  readonly object: Object3D;
  readonly eyePoint = new Vector3();
  readonly stationEyes: ReadonlyMap<CrewStationId, Vector3>;
  /** Body-frame ground contact points (wheel bottoms, tail-skid tip). */
  readonly contactPoints: { wheelL: Vector3; wheelR: Vector3; skid: Vector3 };
  readonly meta: AircraftMeta;

  private readonly spec: AircraftSpec;
  private readonly props: PropView[] = [];
  private readonly dotGeometry: BufferGeometry;
  private readonly surfaces: Partial<Record<'aileronL' | 'aileronR' | 'elevator' | 'rudder', Object3D>> = {};
  private readonly pilot: Object3D | null;
  private readonly stationGuns = new Map<CrewStationId, StationGuns>();
  private readonly crewFigures = new Map<number, Object3D>();
  /** The first flexible station, for the older single-gunner `aimFlexibleGun`. */
  private readonly firstFlexStation: CrewStationId | null;
  private readonly bombStores: BombStoreView[] = [];
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
  private readonly ownedMaterials: Material[] = [];
  private readonly ownedGeometries: BufferGeometry[] = [];
  private readonly discGeometry: BufferGeometry;
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
    this.mergeBombs(root);

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
      if (!/^(Aileron|Elevator|Rudder|Propeller|PropBlades|RotaryEngine|Bombs_|Gun_)/.test(mesh.name) && !/Gauge|Pilot|Gunner|Cockpit/.test(mesh.name)) zm.push(mesh);
      this.zoneMeshes.set(zone, zm);
    });

    this.surfaces.aileronL = root.getObjectByName('Aileron_L');
    this.surfaces.aileronR = root.getObjectByName('Aileron_R');
    this.surfaces.elevator = root.getObjectByName('Elevator');
    this.surfaces.rudder = root.getObjectByName('Rudder');
    this.pilot = root.getObjectByName('Pilot') ?? null;
    // Gunner figures by crew member: Gunner (1), Gunner_2, Gunner_3.
    for (let c = 1; c < 4; c++) {
      const fig = root.getObjectByName(c === 1 ? 'Gunner' : `Gunner_${c}`);
      if (fig) this.crewFigures.set(c, fig);
    }

    // Crew stations: gun mounts and eye points (EyePoint_<station>).
    const eyes = new Map<CrewStationId, Vector3>();
    let firstFlex: CrewStationId | null = null;
    for (const st of crewStations(spec)) {
      const e = root.getObjectByName(`EyePoint_${st.id}`);
      if (e) eyes.set(st.id, e.position.clone());
      if (st.id === 'pilot') continue;
      const pivots: Object3D[] = [];
      for (let k = 1; ; k++) {
        const p = root.getObjectByName(k === 1 ? `Gun_${st.id}` : `Gun_${st.id}_${k}`);
        if (!p) break;
        pivots.push(p);
      }
      // Models built before stations named the observer's mount Gun_Flexible.
      if (pivots.length === 0 && firstFlex === null) {
        const legacy = root.getObjectByName('Gun_Flexible');
        if (legacy) pivots.push(legacy);
      }
      if (pivots.length === 0) continue;
      firstFlex ??= st.id;
      const firstGun = spec.guns[st.guns[0]];
      const aft = st.id === 'dorsal' || st.id === 'ventral' || st.id === 'rear' || (st.id === 'observer' && !!firstGun && firstGun.position[2] > 0);
      const g: StationGuns = { pivots, arcs: st.arcs, stowYaw: aft ? Math.PI : 0, stowPitch: st.id === 'ventral' ? -0.6 : aft ? 0.12 : 0, simAimed: false };
      this.stationGuns.set(st.id, g);
      this.stow(g);
    }
    this.stationEyes = eyes;
    this.firstFlexStation = firstFlex;

    const eye = root.getObjectByName('EyePoint');
    if (eye) this.eyePoint.copy(eye.position);
    else this.eyePoint.set(0, 0.8, 0.4);
    const cp = (n: string, d: Vector3) => root.getObjectByName(n)?.position.clone() ?? d;
    this.contactPoints = {
      wheelL: cp('Contact_WheelL', new Vector3(-0.8, -1.1, -0.5)),
      wheelR: cp('Contact_WheelR', new Vector3(0.8, -1.1, -0.5)),
      skid: cp('Contact_Skid', new Vector3(0, -0.3, 4)),
    };

    // Propellers, each with a blur disc (blurred arc at speed).
    const discGeo = new CircleGeometry(this.meta.prop_radius, 40);
    this.discGeometry = discGeo;
    // Twins have handed propellers turning opposite ways; pushers turn the other way from
    // tractors, judged from where the hub sits (propSpinSign).
    const pivots: [PropNode, string, number][] = [
      ['Propeller', 'PropBlades', 0],
      ['Propeller_L', 'PropBlades_L', 0],
      ['Propeller_R', 'PropBlades_R', 1],
    ];
    root.updateMatrixWorld(true);
    for (const [node, bladesName, engine] of pivots) {
      const pivot = root.getObjectByName(node);
      if (!pivot) continue;
      const blades = root.getObjectByName(bladesName);
      const sign = propSpinSign(node, root.worldToLocal(pivot.getWorldPosition(new Vector3())).z);
      const discMat = new MeshBasicMaterial({ map: propDiscTexture(), transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 });
      this.ownedMaterials.push(discMat);
      const disc = new Mesh(discGeo, discMat);
      disc.name = 'PropDisc';
      disc.renderOrder = 2;
      pivot.add(disc);
      this.props.push({ pivot, blades: blades ?? null, disc, engine, sign, angle: engine * 1.3 });
    }

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

    // Spotting dot for distant viewing (see spotDot.ts)
    const dot = createSpotDot(spec.geometry.span);
    root.add(dot.points);
    this.ownedMaterials.push(dot.material);
    this.dotGeometry = dot.points.geometry;

    // Bullet-hole decals
    this.holeMat = new MeshBasicMaterial({ color: 0x0d0b09, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide });
    this.ownedMaterials.push(this.holeMat);
  }

  update(ac: AircraftEntity, dt: number): void {
    const o = this.object;
    o.position.copy(ac.state.position);
    o.quaternion.copy(ac.state.orientation);
    updateGroundBounce(o.parent);

    // Propellers: rotary engines spin the whole cylinder block with them. A twin's dead engine
    // windmills its propeller with the airflow.
    const engines = ac.damage.engines;
    for (const p of this.props) {
      const dead = engines ? (engines[p.engine] ?? 0) >= 1 : false;
      const rpm = Math.max(0, dead ? Math.min(ac.state.engineRpm, ac.state.airspeed * 9) : ac.state.engineRpm);
      p.angle = (p.angle + (rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
      p.pivot.rotation.z = p.sign * p.angle;
      const blur = smooth(250, 800, rpm);
      (p.disc.material as MeshBasicMaterial).opacity = blur * (this.cockpit ? 0.1 : 0.75); // from the seat the blur is a faint shimmer
      p.disc.visible = blur > 0.01;
      if (p.blades) p.blades.visible = rpm < 700 || this.detached.has('prop');
    }

    // Bombs on the racks: draw as many as are left in each store (none when the sortie carries none).
    for (let s = 0; s < this.bombStores.length; s++) {
      const b = this.bombStores[s];
      const shown = Math.max(0, Math.min(b.count, ac.bombs?.[s] ?? 0));
      if (shown !== b.shown) {
        b.shown = shown;
        b.mesh.geometry.setDrawRange(0, shown * b.perBomb);
        b.mesh.visible = shown > 0;
      }
    }

    // Control surfaces
    const a = controlSurfaceAngles(ac.controls);
    if (this.surfaces.aileronL) this.surfaces.aileronL.rotation.x = a.aileronL;
    if (this.surfaces.aileronR) this.surfaces.aileronR.rotation.x = a.aileronR;
    if (this.surfaces.elevator) this.surfaces.elevator.rotation.x = a.elevator;
    if (this.surfaces.rudder) this.surfaces.rudder.rotation.y = a.rudder;

    // Gun rings follow the sim's gunners (getStationAim: the AI's firing solution, or the
    // player's aim at his station); an idle station goes back to its rest pose. Without a sim
    // aim, an integrator's aimFlexibleGun / setStationAim still holds.
    _invQ.copy(ac.state.orientation).invert();
    for (const [station, g] of this.stationGuns) {
      const w = getStationAim(ac, station);
      if (w) {
        this.aimGuns(g, _aim.copy(w).applyQuaternion(_invQ));
        g.simAimed = true;
      } else if (station === this.firstFlexStation && this.flexAim) {
        const local = this.object.worldToLocal(_aim.copy(this.flexAim)).sub(g.pivots[0].position);
        this.aimGuns(g, local);
        g.simAimed = false;
      } else if (g.simAimed) {
        this.stow(g);
        g.simAimed = false;
      }
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

  /** Swing a station's gun mounts to point along `aimBody` (body frame, any length). */
  setStationAim(station: CrewStationId, aimBody: Vector3): void {
    const g = this.stationGuns.get(station);
    if (!g) return;
    if (station === this.firstFlexStation) this.flexAim = null;
    this.aimGuns(g, aimBody);
  }

  private aimGuns(g: StationGuns, dir: Vector3): void {
    if (dir.lengthSq() < 1e-9) return;
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    // The station's own fields of fire bound the pitch (a bomber's nose gun reaches 60° down,
    // a ventral gun can't point up), so the barrel stays on the sim's tracers.
    const [lo, hi] = gunPitchLimits(g.arcs, Math.atan2(dir.x, -dir.z) * RAD_TO_DEG);
    for (const p of g.pivots) {
      p.rotation.set(0, 0, 0);
      p.rotateY(yaw);
      p.rotateX(Math.max(lo, Math.min(hi, pitch)));
    }
  }

  private stow(g: StationGuns): void {
    for (const p of g.pivots) {
      p.rotation.set(0, 0, 0);
      p.rotateY(g.stowYaw);
      p.rotateX(g.stowPitch);
    }
  }

  /**
   * Merge each bomb store's `Bomb_<store>_<k>` meshes into one mesh (one draw call per store),
   * bomb k's triangles at index range [k·n, (k+1)·n), so drawing the first `remaining` bombs
   * hides the rest. The generator lists each store's bombs in reverse release order.
   */
  private mergeBombs(root: Object3D): void {
    const holder = root.getObjectByName('Bombs');
    if (!holder) return;
    const stores = new Map<number, { k: number; mesh: Mesh }[]>();
    for (const c of holder.children) {
      const m = /^Bomb_(\d+)_(\d+)$/.exec(c.name);
      if (!m || !(c as Mesh).isMesh) continue;
      const list = stores.get(+m[1]) ?? [];
      list.push({ k: +m[2], mesh: c as Mesh });
      stores.set(+m[1], list);
    }
    for (const [s, list] of [...stores].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a.k - b.k);
      holder.updateMatrixWorld(true);
      const geos = list.map(({ mesh }) => {
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        return g.index ? g : g.setIndex([...Array(g.getAttribute('position').count).keys()]);
      });
      const n = geos[0].index!.count;
      const merged = geos.every((g) => g.index!.count === n) ? mergeGeometries(geos, false) : null;
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, list[0].mesh.material);
      mesh.name = `Bombs_${s}`;
      for (const { mesh: m } of list) m.removeFromParent();
      holder.add(mesh);
      this.ownedGeometries.push(merged);
      this.bombStores[s] = { mesh, perBomb: n, count: list.length, shown: -1 };
    }
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

  /** Point the first gunner's weapon at a world position (null = stow). Two-seaters' older API. */
  aimFlexibleGun(worldTarget: Vector3 | null): void {
    this.flexAim = worldTarget ? (this.flexAim ?? new Vector3()).copy(worldTarget) : null;
    const g = this.firstFlexStation ? this.stationGuns.get(this.firstFlexStation) : undefined;
    // A station the sim's gunner is laying keeps his aim (the next update applies it).
    if (!worldTarget && g && !g.simAimed) this.stow(g);
  }

  setStationView(station: CrewStationId | null): void {
    const st = station ? crewStations(this.spec).find((s) => s.id === station) : undefined;
    for (const [crew, fig] of this.crewFigures) fig.visible = !st || st.crewIndex !== crew;
    if (this.pilot) this.pilot.visible = !this.cockpit && st?.crewIndex !== 0;
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
    for (const g of this.ownedGeometries) g.dispose();
    this.discGeometry.dispose();
    this.dotGeometry.dispose();
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
  readonly stationEyes: ReadonlyMap<CrewStationId, Vector3>;
  setStationAim(station: CrewStationId, aimBody: Vector3): void;
  setStationView(station: CrewStationId | null): void;
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
