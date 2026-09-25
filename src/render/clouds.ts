/**
 * Cumulus clouds as clusters of lit, soft billboard puffs, generated on a
 * drifting 3 km cell grid around the camera, plus an optional stratus deck
 * for heavy overcast. Puffs fade out as the camera approaches, so flying
 * through a cloud becomes a fog white-out (see densityAt) rather than an
 * overdraw storm. Cloud placement and density come from src/world/clouds.ts,
 * which the AI also reads, so both see the same clouds at the same mission time.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import type { Weather } from '../core/types';
import { CLOUD_CELL as CELL, CloudField, cloudHash as hash, type CloudBody } from '../world/clouds';
import type { QualityPreset } from './quality';

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  shade: number; // 0 = cloud base, 1 = top
  seed: number;
}

interface Cloud extends CloudBody {
  puffs: Puff[];
}

const PUFF_VERT = /* glsl */ `
attribute vec4 iPuff;   // xyz centre, w radius
attribute vec2 iShade;  // shade (0 base..1 top), seed
uniform vec3 uWindOffset;
varying vec2 vUv;
varying float vShade;
varying float vSeed;
varying float vFade;
varying vec3 vWorldCenter;
varying float vDist;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 c = iPuff.xyz + uWindOffset;
  vWorldCenter = c;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float r = iPuff.w;
  mv.xy += position.xy * r * 1.25;
  vUv = position.xy;
  vShade = iShade.x;
  vSeed = iShade.y;
  float d = length(c - cameraPosition);
  vDist = d;
  // Fade when the camera gets close/inside; fade at far radius.
  vFade = smoothstep(r * 0.6, r * 2.2, d);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFar;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
varying vec2 vUv;
varying float vShade;
varying float vSeed;
varying float vFade;
varying vec3 vWorldCenter;
varying float vDist;
#include <common>
#include <logdepthbuf_pars_fragment>
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = vUv * 1.25;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  // Billowy edge noise.
  vec2 q = uv * 1.7 + vSeed * 17.0;
  float nz = n2(q) * 0.5 + n2(q * 2.3 + 3.0) * 0.3 + n2(q * 5.1 + 7.0) * 0.2;
  float rr = sqrt(r2) + (nz - 0.5) * 0.6;
  float a = 1.0 - smoothstep(0.12, 0.82, rr);
  a *= a;
  // Sphere normal in world space for a puffy lit look.
  float nzv = sqrt(max(0.0, 1.0 - r2));
  vec3 n = normalize(uCamRight * uv.x + uCamUp * uv.y - uCamFwd * nzv);
  float lambert = dot(n, uSunDir) * 0.5 + 0.5;
  float height = clamp(vShade + uv.y * 0.25, 0.0, 1.0);
  float light = clamp(lambert * 0.55 + height * 0.65 - 0.1, 0.0, 1.0);
  // Forward-scattering silver lining when looking toward the sun.
  vec3 viewDir = normalize(vWorldCenter - cameraPosition);
  float fwd = pow(max(dot(viewDir, uSunDir), 0.0), 6.0) * (1.0 - nzv) * 0.6;
  vec3 col = mix(uShadow, uLit, light) + uLit * fwd;
  float alpha = a * vFade * 0.92;
  // Far fade.
  alpha *= 1.0 - smoothstep(uFar * 0.75, uFar, vDist);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist * 0.55);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, f);
}`;

const DECK_VERT = /* glsl */ `
uniform vec3 uWindOffset;
varying vec3 vW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz - uWindOffset;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const DECK_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uCover;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uIsTop;
varying vec3 vW;
#include <common>
#include <logdepthbuf_pars_fragment>
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vW.xz / 2600.0;
  float d = fbm(p);
  float cov = smoothstep(1.0 - uCover - 0.1, 1.0 - uCover + 0.25, d);
  float dist = length(vW - cameraPosition + vec3(0.0));
  vec3 col = uCol * (0.82 + 0.3 * fbm(p * 3.0 + 2.0));
  gl_FragColor = vec4(col, cov * 0.97);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 0.5);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, f);
  gl_FragColor.a *= 1.0 - smoothstep(0.7, 1.0, f);
}`;

export class CloudLayer {
  readonly group = new Group();
  readonly insideColor = new Color(0.8, 0.82, 0.85);
  private readonly geo: InstancedBufferGeometry;
  private readonly puffAttr: InstancedBufferAttribute;
  private readonly shadeAttr: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly deckBase: Mesh;
  private readonly deckTop: Mesh;
  private readonly cells = new Map<string, Cloud[]>();
  private weather: Weather = { cloudCover: 0, cloudBaseM: 1500, cloudTopM: 2200, wind: [0, 0, 0], visibilityM: 30000, turbulence: 0 };
  private field = new CloudField(this.weather);
  /** Mission time of the last update (the drift is wind × time). */
  private time = 0;
  private readonly windOffset = new Vector3();
  private lastBuild = new Vector3(1e9, 0, 0);
  private sortTimer = 0;
  private visible: Puff[] = [];

  constructor(private readonly q: QualityPreset) {
    this.group.name = 'clouds';
    const quad = new PlaneGeometry(2, 2);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.puffAttr = new InstancedBufferAttribute(new Float32Array(q.cloudPuffBudget * 4), 4);
    this.shadeAttr = new InstancedBufferAttribute(new Float32Array(q.cloudPuffBudget * 2), 2);
    this.puffAttr.setUsage(DynamicDrawUsage);
    this.shadeAttr.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPuff', this.puffAttr);
    this.geo.setAttribute('iShade', this.shadeAttr);
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      uniforms: {
        uWindOffset: { value: this.windOffset },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uLit: { value: new Color(1, 1, 1) },
        uShadow: { value: new Color(0.5, 0.52, 0.58) },
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0.00005 },
        uFar: { value: q.cloudRadius },
        uCamRight: { value: new Vector3() },
        uCamUp: { value: new Vector3() },
        uCamFwd: { value: new Vector3() },
      },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);

    const mkDeck = (top: boolean) => {
      const m = new Mesh(
        new PlaneGeometry(2 * q.cloudRadius, 2 * q.cloudRadius, 1, 1).rotateX(top ? -Math.PI / 2 : Math.PI / 2),
        new ShaderMaterial({
          uniforms: {
            uWindOffset: { value: this.windOffset },
            uCol: { value: new Color() },
            uCover: { value: 0.8 },
            uFogColor: { value: new Color() },
            uFogDensity: { value: 0.00005 },
            uIsTop: { value: top ? 1 : 0 },
          },
          vertexShader: DECK_VERT,
          fragmentShader: DECK_FRAG,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = 9;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.deckBase = mkDeck(false);
    this.deckTop = mkDeck(true);
    void AdditiveBlending;
  }

  setWeather(w: Weather, sunDir: Vector3, fogDisplay: Color, overcast: number): void {
    const changed = w.cloudCover !== this.weather.cloudCover || w.cloudBaseM !== this.weather.cloudBaseM || w.cloudTopM !== this.weather.cloudTopM;
    this.weather = w;
    if (changed || w.wind.some((v, i) => v !== this.field.weather.wind[i])) this.field = new CloudField(w);
    const u = this.mat.uniforms;
    u.uSunDir.value.copy(sunDir);
    const el = Math.max(0, sunDir.y);
    const warm = Math.max(0, 1 - el / 0.45);
    // Lit side: white → gold at low sun; shadow side: blue-grey, darker when overcast.
    const lit = new Color(1.25, 1.2 - 0.25 * warm, 1.15 - 0.5 * warm).multiplyScalar(0.45 + 0.55 * Math.min(1, el / 0.25));
    lit.multiplyScalar(1 - 0.35 * overcast);
    u.uLit.value.copy(lit);
    u.uShadow.value.setRGB(0.42, 0.44, 0.5).multiplyScalar((0.45 + 0.55 * Math.min(1, el / 0.25)) * (1 - 0.3 * overcast));
    u.uFogColor.value.copy(fogDisplay);
    u.uFogDensity.value = 2.0 / Math.max(2000, w.visibilityM);
    this.insideColor.setRGB(0.78, 0.8, 0.83).multiplyScalar(0.5 + 0.5 * Math.min(1, el / 0.3)).multiplyScalar(1 - 0.3 * overcast);
    for (const [deck, top] of [[this.deckBase, false], [this.deckTop, true]] as const) {
      const du = (deck.material as ShaderMaterial).uniforms;
      du.uCover.value = Math.min(1, (w.cloudCover - 0.55) * 2.2);
      du.uFogColor.value.copy(fogDisplay);
      du.uFogDensity.value = u.uFogDensity.value;
      du.uCol.value.copy(top ? lit : u.uShadow.value.clone().multiplyScalar(1.15));
      deck.visible = w.cloudCover > 0.6;
    }
    if (changed) {
      this.cells.clear();
      this.lastBuild.set(1e9, 0, 0);
    }
  }

  private cloudsInCell(ix: number, iz: number): Cloud[] {
    const key = `${ix},${iz}`;
    let list = this.cells.get(key);
    if (list) return list;
    list = [];
    for (const body of this.field.bodiesInCell(ix, iz)) {
      const { c, cx, cz, size, rx, rz, base, top } = body;
      const puffs: Puff[] = [];
      const count = Math.round(8 + 22 * Math.min(1, size / 1600));
      for (let p = 0; p < count; p++) {
        const a = hash(ix * 31 + c, iz * 17 + p, 80) * Math.PI * 2;
        const rr = Math.sqrt(hash(ix * 31 + c, iz * 17 + p, 81));
        const hx = Math.cos(a) * rr * rx * 0.8;
        const hz = Math.sin(a) * rr * rz * 0.8;
        // Dome: taller in the middle.
        const domeH = (top - base) * (1 - rr * rr * 0.75);
        const hy = hash(ix * 31 + c, iz * 17 + p, 82) * domeH;
        const r = (0.22 + 0.2 * hash(ix * 31 + c, iz * 17 + p, 83)) * Math.min(rx, rz) * (1 - 0.35 * (hy / Math.max(1, top - base)));
        puffs.push({ x: cx + hx, y: base + Math.max(r * 0.45, hy), z: cz + hz, r, shade: hy / Math.max(1, top - base), seed: hash(p, c, 84) });
      }
      // Flat, darker base layer.
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        puffs.push({ x: cx + Math.cos(a) * rx * 0.35, y: base + size * 0.12, z: cz + Math.sin(a) * rz * 0.35, r: size * 0.42, shade: 0, seed: hash(p, c, 85) });
      }
      list.push({ ...body, puffs });
    }
    this.cells.set(key, list);
    return list;
  }

  /** `time` is mission time: the clouds sit where src/world/clouds.ts says they are. */
  update(dt: number, camera: Camera, time: number): void {
    const w = this.weather;
    this.time = time;
    this.windOffset.set(w.wind[0] * time, 0, w.wind[2] * time);
    const cam = camera.position;
    const u = this.mat.uniforms;
    camera.matrixWorld.extractBasis(u.uCamRight.value, u.uCamUp.value, u.uCamFwd.value);
    (u.uCamFwd.value as Vector3).negate(); // camera looks down -Z
    for (const deck of [this.deckBase, this.deckTop]) {
      const top = deck === this.deckTop;
      deck.position.set(cam.x, top ? w.cloudBaseM + (w.cloudTopM - w.cloudBaseM) * 0.6 : w.cloudBaseM + 60, cam.z);
    }
    if (w.cloudCover <= 0.02) {
      this.geo.instanceCount = 0;
      return;
    }
    // Cells in the drifting frame.
    const lx = cam.x - this.windOffset.x;
    const lz = cam.z - this.windOffset.z;
    const local = new Vector3(lx, cam.y, lz);
    if (local.distanceTo(this.lastBuild) > 1500) {
      this.lastBuild.copy(local);
      const R = this.q.cloudRadius;
      const rc = Math.ceil(R / CELL);
      const cx = Math.floor(lx / CELL), cz = Math.floor(lz / CELL);
      const vis: Puff[] = [];
      const all: { cl: Cloud; d: number }[] = [];
      for (let i = -rc; i <= rc; i++)
        for (let j = -rc; j <= rc; j++) {
          const ccx = (cx + i + 0.5) * CELL, ccz = (cz + j + 0.5) * CELL;
          if (Math.hypot(ccx - lx, ccz - lz) > R + CELL) continue;
          for (const cl of this.cloudsInCell(cx + i, cz + j)) {
            const d = Math.hypot(cl.cx - lx, cl.cz - lz);
            if (d < R) all.push({ cl, d });
          }
        }
      // Nearest clouds first; distant ones use fewer, larger puffs (LOD).
      all.sort((a, b) => a.d - b.d);
      const budget = this.q.cloudPuffBudget;
      for (const { cl, d } of all) {
        const stride = d < 10_000 ? 1 : d < 22_000 ? 2 : 4;
        const grow = stride === 1 ? 1 : stride === 2 ? 1.3 : 1.65;
        for (let k = 0; k < cl.puffs.length && vis.length < budget; k += stride) {
          const p = cl.puffs[k];
          vis.push(stride === 1 ? p : { ...p, r: p.r * grow });
        }
        if (vis.length >= budget) break;
      }
      // Drop old cells far away.
      if (this.cells.size > 1500) this.cells.clear();
      this.visible = vis;
      this.sortTimer = 0;
    }
    this.sortTimer -= dt;
    if (this.sortTimer <= 0) {
      this.sortTimer = 0.25;
      const vis = this.visible;
      const d = new Float32Array(vis.length);
      for (let i = 0; i < vis.length; i++) {
        const p = vis[i];
        const dx = p.x - lx, dy = p.y - cam.y, dz = p.z - lz;
        d[i] = dx * dx + dy * dy + dz * dz;
      }
      const order = Array.from(vis.keys()).sort((a, b) => d[b] - d[a]);
      const pa = this.puffAttr.array as Float32Array;
      const sa = this.shadeAttr.array as Float32Array;
      order.forEach((k, i) => {
        const p = vis[k];
        pa[i * 4] = p.x;
        pa[i * 4 + 1] = p.y;
        pa[i * 4 + 2] = p.z;
        pa[i * 4 + 3] = p.r;
        sa[i * 2] = p.shade;
        sa[i * 2 + 1] = p.seed;
      });
      this.puffAttr.needsUpdate = true;
      this.shadeAttr.needsUpdate = true;
      this.geo.instanceCount = vis.length;
    }
  }

  /** 0..1 cloud density at a world position (for in-cloud fog). */
  densityAt(p: Vector3): number {
    return this.field.densityAt(p.x, p.y, p.z, this.time);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
