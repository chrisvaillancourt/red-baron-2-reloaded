/**
 * CPU-simulated, GPU-instanced billboard particles. Two pools share this
 * class: an alpha-blended pool (smoke, flak, dust, debris) and an additive
 * pool (fire, flashes, sparks).
 */
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  color: Color | [number, number, number];
  alpha0?: number;
  alpha1?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  /** Upward acceleration (m/s²; negative = gravity). */
  lift?: number;
  /** Follows the wind (0..1). */
  windFollow?: number;
  spin?: number;
  /** Shape: 0 = soft puff, 1 = hard spark/flake. */
  shape?: number;
  /** Stretch along velocity (sparks). */
  stretch?: number;
}

const VERT = /* glsl */ `
attribute vec4 iPos;   // xyz, size
attribute vec4 iCol;   // rgb, alpha
attribute vec4 iMisc;  // rotation, shape, stretch, seed
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vSeed;
varying float vDist;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float s = iPos.w;
  float c = cos(iMisc.x), sn = sin(iMisc.x);
  vec2 p = vec2(position.x * c - position.y * sn, position.x * sn + position.y * c);
  if (iMisc.z > 0.0) {
    // Stretch along screen-space velocity.
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    p = dir * position.x * (1.0 + iMisc.z) + perp * position.y;
  }
  mv.xy += p * s;
  vUv = position.xy;
  vCol = iCol;
  vShape = iMisc.y;
  vSeed = iMisc.w;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAdditive;
uniform vec3 uSunTint;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vSeed;
varying float vDist;
#include <common>
#include <logdepthbuf_pars_fragment>
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float a;
  vec3 col = vCol.rgb;
  if (vShape < 0.5) {
    vec2 q = vUv * 2.5 + vSeed * 13.0;
    float nz = n2(q) * 0.6 + n2(q * 2.3) * 0.4;
    // Noise-eroded, soft-cored billow: ragged edges instead of a cotton ball.
    float edge = r + (nz - 0.5) * 0.6;
    a = 1.0 - smoothstep(0.1, 0.92, edge);
    a *= a * (3.0 - 2.0 * a);
    // Self-shadowing: darker toward the bottom of each puff (not for additive).
    if (uAdditive < 0.5) col *= mix(1.0, 0.75 + 0.25 * (vUv.y * 0.5 + 0.5), 0.8) * uSunTint;
  } else {
    a = 1.0 - smoothstep(0.5, 1.0, r);
  }
  a *= vCol.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  if (uAdditive > 0.5) gl_FragColor.rgb *= (1.0 - f);
  else gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, f);
}`;

export class ParticlePool {
  readonly mesh: Mesh;
  private readonly cap: number;
  private n = 0;
  // Simulation state (SoA)
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array; // size0, size1
  private readonly col: Float32Array;
  private readonly alpha: Float32Array; // a0, a1
  private readonly phys: Float32Array; // drag, lift, windFollow, spin
  private readonly misc: Float32Array; // rot, shape, stretch, seed
  // GPU attributes
  private readonly aPos: InstancedBufferAttribute;
  private readonly aCol: InstancedBufferAttribute;
  private readonly aMisc: InstancedBufferAttribute;
  private readonly aVel: InstancedBufferAttribute;
  private readonly geo: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  private sortCounter = 0;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity * 2);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity * 2);
    this.phys = new Float32Array(capacity * 4);
    this.misc = new Float32Array(capacity * 4);
    const quad = new PlaneGeometry(2, 2);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(4);
    this.aCol = mk(4);
    this.aMisc = mk(4);
    this.aVel = mk(3);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iCol', this.aCol);
    this.geo.setAttribute('iMisc', this.aMisc);
    this.geo.setAttribute('iVel', this.aVel);
    this.geo.instanceCount = 0;
    this.material = new ShaderMaterial({
      uniforms: {
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0.00005 },
        uAdditive: { value: additive ? 1 : 0 },
        uSunTint: { value: new Color(1, 1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 21 : 20;
  }

  get count(): number {
    return this.n;
  }

  spawn(s: ParticleSpawn): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else {
      // Replace the oldest-by-fraction particle.
      i = Math.floor(Math.random() * this.cap);
    }
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z;
    this.vel[i * 3] = s.vx ?? 0;
    this.vel[i * 3 + 1] = s.vy ?? 0;
    this.vel[i * 3 + 2] = s.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.size[i * 2] = s.size0;
    this.size[i * 2 + 1] = s.size1;
    const c = s.color;
    if (c instanceof Color) {
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
    } else {
      this.col[i * 3] = c[0];
      this.col[i * 3 + 1] = c[1];
      this.col[i * 3 + 2] = c[2];
    }
    this.alpha[i * 2] = s.alpha0 ?? 1;
    this.alpha[i * 2 + 1] = s.alpha1 ?? 0;
    this.phys[i * 4] = s.drag ?? 0;
    this.phys[i * 4 + 1] = s.lift ?? 0;
    this.phys[i * 4 + 2] = s.windFollow ?? 0;
    this.phys[i * 4 + 3] = s.spin ?? 0;
    this.misc[i * 4] = Math.random() * Math.PI * 2;
    this.misc[i * 4 + 1] = s.shape ?? 0;
    this.misc[i * 4 + 2] = s.stretch ?? 0;
    this.misc[i * 4 + 3] = Math.random();
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    const cp = (arr: Float32Array, k: number) => {
      for (let c = 0; c < k; c++) arr[i * k + c] = arr[j * k + c];
    };
    cp(this.pos, 3);
    cp(this.vel, 3);
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    cp(this.size, 2);
    cp(this.col, 3);
    cp(this.alpha, 2);
    cp(this.phys, 4);
    cp(this.misc, 4);
  }

  update(dt: number, wind: Vector3, camera: Camera, sort: boolean): void {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        i--;
        continue;
      }
      const drag = this.phys[i * 4];
      const lift = this.phys[i * 4 + 1];
      const wf = this.phys[i * 4 + 2];
      const k = Math.exp(-drag * dt);
      for (let c = 0; c < 3; c++) {
        const w = c === 0 ? wind.x : c === 1 ? wind.y : wind.z;
        let v = this.vel[i * 3 + c];
        v = w * wf + (v - w * wf) * k;
        if (c === 1) v += lift * dt;
        this.vel[i * 3 + c] = v;
        this.pos[i * 3 + c] += v * dt;
      }
      this.misc[i * 4] += this.phys[i * 4 + 3] * dt;
    }
    // Back-to-front order for alpha pools (every few frames).
    let order: number[] | null = null;
    if (sort && this.n > 1 && this.sortCounter++ % 3 === 0) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const d = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) {
        const dx = this.pos[i * 3] - cx, dy = this.pos[i * 3 + 1] - cy, dz = this.pos[i * 3 + 2] - cz;
        d[i] = dx * dx + dy * dy + dz * dz;
      }
      order = Array.from({ length: this.n }, (_, i) => i).sort((a, b) => d[b] - d[a]);
      this.lastOrder = order;
    } else if (sort && this.lastOrder && this.lastOrder.length === this.n) order = this.lastOrder;
    const P = this.aPos.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    for (let o = 0; o < this.n; o++) {
      const i = order ? order[o] : o;
      const t = this.age[i] / this.life[i];
      const s = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * Math.sqrt(t);
      const a0 = this.alpha[i * 2], a1 = this.alpha[i * 2 + 1];
      // Fade in quickly, then toward a1.
      const a = Math.min(1, t * 12) * (a0 + (a1 - a0) * t);
      P[o * 4] = this.pos[i * 3];
      P[o * 4 + 1] = this.pos[i * 3 + 1];
      P[o * 4 + 2] = this.pos[i * 3 + 2];
      P[o * 4 + 3] = s;
      C[o * 4] = this.col[i * 3];
      C[o * 4 + 1] = this.col[i * 3 + 1];
      C[o * 4 + 2] = this.col[i * 3 + 2];
      C[o * 4 + 3] = a;
      M[o * 4] = this.misc[i * 4];
      M[o * 4 + 1] = this.misc[i * 4 + 1];
      M[o * 4 + 2] = this.misc[i * 4 + 2];
      M[o * 4 + 3] = this.misc[i * 4 + 3];
      V[o * 3] = this.vel[i * 3];
      V[o * 3 + 1] = this.vel[i * 3 + 1];
      V[o * 3 + 2] = this.vel[i * 3 + 2];
    }
    this.geo.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private lastOrder: number[] | null = null;

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
