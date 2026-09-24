/**
 * Aerodromes active on the mission date: Bessonneau canvas hangars, bell
 * tents, wooden huts, fuel drums, a landing "T" and a windsock that follows
 * the wind. Placed on the (flattened) terrain from src/data/aerodromes.ts.
 */
import {
  BoxGeometry,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Weather } from '../core/types';
import { aerodromesActiveOn, type AerodromeWorld } from '../data/aerodromes';
import { terrainHeightAt } from '../world/terrain';

/** Mown-grass stripes (tileable greyscale, tinted by material colour). */
function mownTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  for (let x = 0; x < 256; x++) {
    const band = Math.floor(x / 32) % 2 === 0 ? 230 : 214;
    for (let y = 0; y < 256; y += 4) {
      const n = band + Math.round((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * 18);
      ctx.fillStyle = `rgb(${n},${n},${n})`;
      ctx.fillRect(x, y, 1, 4);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(560 / 64, 12);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Bessonneau hangar: wooden frame with a canvas roof of shallow arched profile. */
function bessonneauGeometry(): BufferGeometry {
  const w = 20, d = 24, wallH = 3.2, ridge = 8.2;
  const segs = 10;
  const pos: number[] = [];
  // Profile: vertical walls to wallH then an ogee-ish curve to the ridge.
  const prof: [number, number][] = [];
  prof.push([-w / 2, 0], [-w / 2, wallH]);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const x = -w / 2 + t * w;
    const y = wallH + (ridge - wallH) * Math.sin(t * Math.PI) ** 0.8;
    prof.push([x, y]);
  }
  prof.push([w / 2, wallH], [w / 2, 0]);
  for (let i = 0; i < prof.length - 1; i++) {
    const [x0, y0] = prof[i];
    const [x1, y1] = prof[i + 1];
    pos.push(x0, y0, -d / 2, x1, y1, -d / 2, x1, y1, d / 2, x0, y0, -d / 2, x1, y1, d / 2, x0, y0, d / 2);
  }
  // Back wall (closed) as a fan.
  for (let i = 1; i < prof.length - 1; i++) {
    const [x0, y0] = prof[i];
    const [x1, y1] = prof[i + 1];
    pos.push(0, 0, -d / 2, x1, y1, -d / 2, x0, y0, -d / 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function hut(): BufferGeometry {
  const b = new BoxGeometry(6, 2.6, 12).translate(0, 1.3, 0);
  const r = new BoxGeometry(6.6, 0.2, 12.6).translate(0, 2.7, 0);
  b.deleteAttribute('uv');
  r.deleteAttribute('uv');
  return mergeGeometries([b, r])!;
}

function tent(): BufferGeometry {
  const c = new ConeGeometry(2.4, 3, 10, 1, false);
  c.translate(0, 1.5, 0);
  return c;
}

export class AerodromeLayer {
  readonly group = new Group();
  private readonly canvasMat = new MeshStandardMaterial({ color: 0xb1a584, roughness: 0.95, side: DoubleSide });
  private readonly germanCanvasMat = new MeshStandardMaterial({ color: 0x8d8876, roughness: 0.95, side: DoubleSide });
  private readonly woodMat = new MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 });
  private readonly tentMat = new MeshStandardMaterial({ color: 0xc4b894, roughness: 0.95 });
  private readonly whiteMat = new MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.9 });
  private readonly sockMat = new MeshStandardMaterial({ color: 0xe0dcd0, roughness: 0.8, side: DoubleSide });
  private readonly grassMat = new MeshStandardMaterial({ map: mownTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0x6e8a44 });
  private readonly drumMat = new MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.6, metalness: 0.3 });
  private readonly hangarGeo = bessonneauGeometry();
  private readonly hutGeo = hut();
  private readonly tentGeo = tent();
  private readonly socks: Group[] = [];
  private t = 0;

  constructor(date: string) {
    this.group.name = 'aerodromes';
    this.build(date);
  }

  setDate(date: string): void {
    this.group.clear();
    this.socks.length = 0;
    this.build(date);
  }

  private build(date: string): void {
    for (const a of aerodromesActiveOn(date)) this.group.add(this.buildField(a));
  }

  private buildField(a: AerodromeWorld): Group {
    const g = new Group();
    g.name = `aerodrome:${a.id}`;
    const y = terrainHeightAt(a.x, a.z);
    g.position.set(a.x, y, a.z);
    // Local frame: runway along local -Z (heading), hangars to the right side.
    g.rotation.y = -(a.runwayHeadingDeg * Math.PI) / 180;
    const canvas = a.side === 'central' ? this.germanCanvasMat : this.canvasMat;
    const nH = 3 + (a.id.length % 3);
    for (let i = 0; i < nH; i++) {
      const h = new Mesh(this.hangarGeo, canvas);
      // Hangar mouths face the strip (-X).
      h.rotation.y = Math.PI / 2;
      h.position.set(150, 0, -((nH - 1) / 2) * 26 + i * 26);
      h.castShadow = true;
      h.receiveShadow = true;
      g.add(h);
    }
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(this.hutGeo, this.woodMat);
      m.position.set(200, 0, -60 + i * 40);
      m.castShadow = true;
      g.add(m);
    }
    for (let i = 0; i < 8; i++) {
      const t = new Mesh(this.tentGeo, this.tentMat);
      t.position.set(235 + (i % 2) * 9, 0, -40 + Math.floor(i / 2) * 11);
      t.castShadow = true;
      g.add(t);
    }
    for (let i = 0; i < 10; i++) {
      const d = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 8), this.drumMat);
      d.position.set(135 + (i % 3) * 0.7, 0.45, 60 + Math.floor(i / 3) * 0.7);
      g.add(d);
    }
    // Mown landing ground (the field is flattened, so a flat decal sits on it).
    const grass = new Mesh(new PlaneGeometry(560, a.runwayLength + 120).rotateX(-Math.PI / 2), this.grassMat);
    grass.position.y = 0.05;
    grass.receiveShadow = true;
    g.add(grass);
    // Landing T at the downwind end of the strip (allied practice; harmless on German fields).
    const T = new Group();
    const bar = new Mesh(new PlaneGeometry(1.5, 12).rotateX(-Math.PI / 2), this.whiteMat);
    const top = new Mesh(new PlaneGeometry(10, 1.5).rotateX(-Math.PI / 2), this.whiteMat);
    top.position.z = -6;
    T.add(bar, top);
    T.position.set(-40, 0.08, a.runwayLength / 2 - 60);
    g.add(T);
    // Windsock
    const sock = new Group();
    const pole = new Mesh(new CylinderGeometry(0.08, 0.12, 7, 6), this.woodMat);
    pole.position.y = 3.5;
    const cone = new Mesh(new ConeGeometry(0.45, 3, 10, 1, true).rotateZ(Math.PI / 2).translate(1.5, 0, 0), this.sockMat);
    const pivot = new Group();
    pivot.position.y = 6.8;
    pivot.add(cone);
    sock.add(pole, pivot);
    sock.position.set(100, 0, -a.runwayLength / 2);
    sock.userData.pivot = pivot;
    sock.userData.fieldRot = g.rotation.y;
    g.add(sock);
    this.socks.push(sock);
    return g;
  }

  /** Tint the mown grass to the season palette. */
  setGrassColor(hex: string): void {
    this.grassMat.color.set(hex).multiplyScalar(1.12);
  }

  update(dt: number, weather: Weather): void {
    this.t += dt;
    const [wx, , wz] = weather.wind;
    const speed = Math.hypot(wx, wz);
    for (const s of this.socks) {
      const pivot = s.userData.pivot as Group;
      // Sock points downwind (the direction the wind blows toward).
      const worldAng = Math.atan2(-wz, wx);
      pivot.rotation.y = worldAng - (s.userData.fieldRot as number) + Math.sin(this.t * 3.1) * 0.08;
      pivot.rotation.z = -Math.max(0, 1.2 - speed * 0.15) + Math.sin(this.t * 4.3) * 0.05;
    }
  }
}
