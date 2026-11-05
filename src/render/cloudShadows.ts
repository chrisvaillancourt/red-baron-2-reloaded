/**
 * Cumulus shadows on the ground.
 *
 * A small coverage texture in the clouds' drifting frame (src/world/clouds.ts):
 * each cumulus body is splatted as a soft ellipse, already offset along the sun
 * direction by its height. Because the texture lives in the drifting frame, the
 * shader only subtracts the wind drift each frame and the shadows glide smoothly;
 * the texture is rebuilt only when the camera has travelled a few kilometres or the
 * weather or sun changes. Shaders add the GLSL in CLOUD_SHADOW_GLSL and read
 * `cloudShadow(worldXZ)` (0 = sunlit, 1 = fully shaded).
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2, Vector3, Vector4, type IUniform, type Material } from 'three';
import type { Weather } from '../core/types';
import { CLOUD_CELL, CloudField, cloudDrift, cloudHash } from '../world/clouds';

const SIZE = 256;
/** Side of the covered square, metres. Beyond ~20 km the haze hides ground detail anyway. */
const SPAN = 44_000;
const TEXEL = SPAN / SIZE;
/** Rebuild once the camera's drifting-frame position is this far from the texture centre. */
const RECENTER_M = 3000;

export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uCloudShadow;
uniform vec4 uCloudShadowRect; // frame x0, z0, 1/span, 1/span
uniform vec2 uCloudDrift;      // wind drift of the cloud frame (m)
uniform float uCloudShadowK;   // 0 = off
float csHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float csNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(csHash(i), csHash(i + vec2(1, 0)), u.x), mix(csHash(i + vec2(0, 1)), csHash(i + vec2(1, 1)), u.x), u.y);
}
float cloudShadow(vec2 worldXZ) {
  if (uCloudShadowK <= 0.0) return 0.0;
  // Warp in the drifting frame so the ragged outline travels with its cloud.
  vec2 f = worldXZ - uCloudDrift;
  vec2 warp = vec2(csNoise(f / 700.0), csNoise(f / 700.0 + 7.3)) - 0.5;
  warp += (vec2(csNoise(f / 230.0 + 3.1), csNoise(f / 230.0 + 11.7)) - 0.5) * 0.4;
  vec2 uv = (f + warp * 520.0 - uCloudShadowRect.xy) * uCloudShadowRect.zw;
  float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(0.0, 0.06, uv.y) * smoothstep(1.0, 0.94, uv.x) * smoothstep(1.0, 0.94, uv.y);
  float c = texture2D(uCloudShadow, uv).r * edge;
  if (c <= 0.0) return 0.0;
  // Ragged rim: threshold the soft splat against fine noise.
  float rag = csNoise(f / 420.0) * 0.6 + csNoise(f / 130.0 + 5.1) * 0.4;
  return smoothstep(0.08, 0.6, c + (rag - 0.5) * 0.45) * c * uCloudShadowK;
}
`;

/**
 * Make a lit three material (Standard/Lambert/Phong, instanced or not) darken its
 * sunlight under cloud shadows. Chains any existing onBeforeCompile.
 */
export function addCloudShadows(material: Material, uniforms: Record<string, IUniform>): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vCsWorld;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 csw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        csw = instanceMatrix * csw;
        #endif
        vCsWorld = (modelMatrix * csw).xz;
      }`,
    );
    shader.fragmentShader = 'varying vec2 vCsWorld;\n' + CLOUD_SHADOW_GLSL + shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      {
        float cs = cloudShadow(vCsWorld);
        reflectedLight.directDiffuse *= 1.0 - cs;
        reflectedLight.directSpecular *= 1.0 - cs;
      }`,
    );
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|cloud-shadows-v1`;
  material.needsUpdate = true;
}

export class CloudShadows {
  readonly texture: DataTexture;
  private readonly data = new Uint8Array(SIZE * SIZE);
  readonly uniforms: Record<'uCloudShadow' | 'uCloudShadowRect' | 'uCloudDrift' | 'uCloudShadowK', IUniform>;
  private field: CloudField | null = null;
  private weather: Weather | null = null;
  private readonly sun = new Vector3(0, 1, 0);
  private readonly center = new Vector2(1e12, 1e12);
  private strength = 0;
  private dirty = true;
  /** Rebuilds so far (diagnostics and tests). */
  builds = 0;

  constructor() {
    this.texture = new DataTexture(this.data, SIZE, SIZE, RedFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uCloudShadow: { value: this.texture },
      uCloudShadowRect: { value: new Vector4(0, 0, 1 / SPAN, 1 / SPAN) },
      uCloudDrift: { value: new Vector2() },
      uCloudShadowK: { value: 0 },
    };
  }

  /** Weather, sun and how strongly shadows darken direct sunlight (0 = none). */
  setWeather(w: Weather, sunDirection: Vector3, overcast: number): void {
    this.weather = w;
    this.field = new CloudField(w);
    this.sun.copy(sunDirection);
    // Under a full overcast the sun is already dimmed everywhere; patches would be wrong.
    // A sun near the horizon throws shadows so far and so stretched they read as noise.
    const sunUp = Math.min(1, Math.max(0, (sunDirection.y - 0.08) / 0.15));
    this.strength = this.field.clear ? 0 : 0.78 * (1 - overcast) * sunUp;
    this.dirty = true;
  }

  /** Call every frame with the camera position and mission time. */
  update(camera: Vector3, time: number): void {
    const w = this.weather;
    const u = this.uniforms;
    u.uCloudShadowK.value = this.strength;
    if (!w || this.strength <= 0) return;
    const drift = cloudDrift(w, time);
    (u.uCloudDrift.value as Vector2).set(drift.x, drift.z);
    const fx = camera.x - drift.x;
    const fz = camera.z - drift.z;
    if (!this.dirty && Math.hypot(fx - this.center.x, fz - this.center.y) < RECENTER_M) return;
    this.build(fx, fz);
  }

  private build(fx: number, fz: number): void {
    const field = this.field!;
    // Snap to whole texels so a rebuild never shifts the pattern by a fraction of one.
    const cx = Math.round(fx / TEXEL) * TEXEL;
    const cz = Math.round(fz / TEXEL) * TEXEL;
    this.center.set(cx, cz);
    this.dirty = false;
    this.builds++;
    const x0 = cx - SPAN / 2;
    const z0 = cz - SPAN / 2;
    (this.uniforms.uCloudShadowRect.value as Vector4).set(x0, z0, 1 / SPAN, 1 / SPAN);
    this.data.fill(0);
    // A cloud at height h shades the ground displaced by -sun.xz / sun.y * h.
    const sy = Math.max(0.12, this.sun.y);
    const ox = -this.sun.x / sy;
    const oz = -this.sun.z / sy;
    // Cells whose clouds can land in the square: widen by the largest offset.
    const reach = Math.hypot(ox, oz) * (this.weather!.cloudTopM + 200) + 2500;
    const i0 = Math.floor((x0 - reach) / CLOUD_CELL);
    const i1 = Math.floor((x0 + SPAN + reach) / CLOUD_CELL);
    const j0 = Math.floor((z0 - reach) / CLOUD_CELL);
    const j1 = Math.floor((z0 + SPAN + reach) / CLOUD_CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (const c of field.bodiesInCell(i, j)) {
          const h = (c.base + c.top) / 2;
          const depth = Math.min(1, 0.55 + (c.top - c.base) / 1400);
          // A heap of lobes, like the puffs above it, rather than one ellipse.
          const lobes = 3 + Math.floor(cloudHash(c.ix, c.iz, 400 + c.c) * 3);
          for (let l = 0; l < lobes; l++) {
            const a = cloudHash(c.ix, c.iz, 410 + c.c * 8 + l) * Math.PI * 2;
            const r = l === 0 ? 0 : 0.25 + 0.3 * cloudHash(c.ix, c.iz, 420 + c.c * 8 + l);
            const k = l === 0 ? 0.8 : 0.45 + 0.25 * cloudHash(c.ix, c.iz, 430 + c.c * 8 + l);
            this.splat(c.cx + ox * h + Math.cos(a) * r * c.rx, c.cz + oz * h + Math.sin(a) * r * c.rz, c.rx * k, c.rz * k, depth, x0, z0);
          }
        }
    this.texture.needsUpdate = true;
  }

  private splat(sx: number, sz: number, rx: number, rz: number, depth: number, x0: number, z0: number): void {
    const data = this.data;
    const ua = Math.max(0, Math.floor((sx - rx - x0) / TEXEL));
    const ub = Math.min(SIZE - 1, Math.ceil((sx + rx - x0) / TEXEL));
    const va = Math.max(0, Math.floor((sz - rz - z0) / TEXEL));
    const vb = Math.min(SIZE - 1, Math.ceil((sz + rz - z0) / TEXEL));
    for (let v = va; v <= vb; v++) {
      const dz = (z0 + (v + 0.5) * TEXEL - sz) / rz;
      for (let u = ua; u <= ub; u++) {
        const dx = (x0 + (u + 0.5) * TEXEL - sx) / rx;
        const d = dx * dx + dz * dz;
        if (d >= 1) continue;
        // Smooth falloff over the outer 45 %.
        const t = Math.min(1, (1 - Math.sqrt(d)) / 0.45);
        const s = Math.round(255 * depth * t * t * (3 - 2 * t));
        const k = v * SIZE + u;
        if (s > data[k]) data[k] = s;
      }
    }
  }

  /** Shade (0..1) at a world point, from the CPU copy (tests and diagnostics). */
  sample(x: number, z: number, time: number): number {
    if (!this.weather || this.strength <= 0) return 0;
    const drift = cloudDrift(this.weather, time);
    const r = this.uniforms.uCloudShadowRect.value as Vector4;
    const u = Math.floor((x - drift.x - r.x) / TEXEL);
    const v = Math.floor((z - drift.z - r.y) / TEXEL);
    if (u < 0 || v < 0 || u >= SIZE || v >= SIZE) return 0;
    return (this.data[v * SIZE + u] / 255) * this.strength;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
