/**
 * Display-space post-processing: bloom, color grade, vignette and film grain.
 *
 * The scene still renders straight to the canvas exactly as before (tone mapping,
 * sRGB and three's display-space fog included), so every custom shader keeps its
 * conventions. Afterwards the finished frame is copied into a texture and composited
 * back over the canvas with the effects applied. Working on display values suits the
 * grade and grain; the bloom is a soft glow on bright pixels (sun, fire, flashes),
 * not a physical HDR bloom.
 *
 * Cost at 1080p: one full-screen copy, one full-screen composite and a small
 * half-resolution-and-below blur chain.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  FramebufferTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** Grade settings; `PostGrade` values come from the time of day and weather. */
export interface PostGrade {
  /** S-curve contrast blend: 0 = none, 1 = full smoothstep curve. */
  contrast: number;
  /** Saturation multiplier (1 = unchanged). */
  saturation: number;
  /** Per-channel multiplier applied after the curve (white balance / tint). */
  gain: [number, number, number];
  /** Black-level lift per channel (shadows tint). */
  lift: [number, number, number];
}

export interface PostFxOptions {
  bloom: boolean;
  /** Bloom strength (screen-blended). */
  bloomStrength: number;
  /** Luminance above which pixels glow (display space, 0..1). */
  bloomThreshold: number;
  vignette: number;
  grain: number;
}

export const NEUTRAL_GRADE: PostGrade = { contrast: 0, saturation: 1, gain: [1, 1, 1], lift: [0, 0, 0] };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Bright pass + 13-tap downsample (Jimenez 2014) from the full-resolution frame.
const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
vec3 bright(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.08;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  return c * w;
}
void main() {
  vec3 a = s(vec2(-2.0, -2.0)), b = s(vec2(0.0, -2.0)), c = s(vec2(2.0, -2.0));
  vec3 d = s(vec2(-1.0, -1.0)), e = s(vec2(1.0, -1.0));
  vec3 f = s(vec2(-2.0, 0.0)), g = s(vec2(0.0, 0.0)), h = s(vec2(2.0, 0.0));
  vec3 i = s(vec2(-1.0, 1.0)), j = s(vec2(1.0, 1.0));
  vec3 k = s(vec2(-2.0, 2.0)), l = s(vec2(0.0, 2.0)), m = s(vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
  gl_FragColor = vec4(bright(col), 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

// Tent upsample of the smaller level, averaged with this level's downsample.
const UP_FRAG = /* glsl */ `
uniform sampler2D tSmall;
uniform sampler2D tSame;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSmall, vUv + vec2(-1.0, 0.0) * uTexel).rgb * 2.0;
  c += texture2D(tSmall, vUv + vec2(1.0, 0.0) * uTexel).rgb * 2.0;
  c += texture2D(tSmall, vUv + vec2(0.0, -1.0) * uTexel).rgb * 2.0;
  c += texture2D(tSmall, vUv + vec2(0.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(tSmall, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSmall, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSmall, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture2D(tSmall, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  c += texture2D(tSmall, vUv).rgb * 4.0;
  c /= 16.0;
  gl_FragColor = vec4((c + texture2D(tSame, vUv).rgb) * 0.5, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  #ifdef USE_BLOOM
  vec3 b = texture2D(tBloom, vUv).rgb * uBloom;
  c = 1.0 - (1.0 - c) * (1.0 - clamp(b, 0.0, 1.0));
  #endif
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(0.0), mix(vec3(l), c, uSaturation));
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = c * uGain + uLift * (1.0 - c);
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.45, 1.15, length(d) * 1.25);
  // Grain: luminance-weighted so dark areas don't fizz.
  float n = hash(floor(vUv * uRes) + fract(uTime) * 917.0) - 0.5;
  c += n * uGrain * (0.35 + 0.65 * l);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function pass(frag: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, string> = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function target(w: number, h: number): WebGLRenderTarget {
  return new WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
}

const BLOOM_LEVELS = 5;

export class PostFx {
  enabled = true;
  readonly options: PostFxOptions;
  readonly grade: PostGrade = { ...NEUTRAL_GRADE, gain: [1, 1, 1], lift: [0, 0, 0] };
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly prefilter: ShaderMaterial;
  private readonly down: ShaderMaterial;
  private readonly up: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private frame: FramebufferTexture | null = null;
  private downs: WebGLRenderTarget[] = [];
  private ups: WebGLRenderTarget[] = [];
  private readonly size = new Vector2();
  private time = 0;

  constructor(options: PostFxOptions) {
    this.options = { ...options };
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    this.prefilter = pass(PREFILTER_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: options.bloomThreshold } });
    this.down = pass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() } });
    this.up = pass(UP_FRAG, { tSmall: { value: null }, tSame: { value: null }, uTexel: { value: new Vector2() } });
    this.composite = pass(
      COMPOSITE_FRAG,
      {
        tScene: { value: null },
        tBloom: { value: null },
        uBloom: { value: options.bloomStrength },
        uContrast: { value: 0 },
        uSaturation: { value: 1 },
        uGain: { value: [1, 1, 1] },
        uLift: { value: [0, 0, 0] },
        uVignette: { value: options.vignette },
        uGrain: { value: options.grain },
        uTime: { value: 0 },
        uRes: { value: new Vector2(1, 1) },
      },
      options.bloom ? { USE_BLOOM: '' } : {},
    );
    this.quad = new Mesh(geo, this.composite);
    this.quad.frustumCulled = false;
  }

  /** Apply the effects to what is on the canvas now. Call right after the scene render. */
  render(renderer: WebGLRenderer, dt: number): void {
    if (!this.enabled) return;
    this.time += dt;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    this.ensureTargets(w, h);
    const frame = this.frame!;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(frame);

    let bloomTex: Texture | null = null;
    if (this.options.bloom) {
      const u = this.prefilter.uniforms;
      u.tSrc.value = frame;
      (u.uTexel.value as Vector2).set(1 / w, 1 / h);
      u.uThreshold.value = this.options.bloomThreshold;
      this.draw(renderer, this.prefilter, this.downs[0]);
      for (let i = 1; i < this.downs.length; i++) {
        const src = this.downs[i - 1];
        this.down.uniforms.tSrc.value = src.texture;
        (this.down.uniforms.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
        this.draw(renderer, this.down, this.downs[i]);
      }
      let small: WebGLRenderTarget = this.downs[this.downs.length - 1];
      for (let i = this.downs.length - 2; i >= 0; i--) {
        const out = this.ups[i];
        this.up.uniforms.tSmall.value = small.texture;
        this.up.uniforms.tSame.value = this.downs[i].texture;
        (this.up.uniforms.uTexel.value as Vector2).set(1 / small.width, 1 / small.height);
        this.draw(renderer, this.up, out);
        small = out;
      }
      bloomTex = small.texture;
    }

    const c = this.composite.uniforms;
    c.tScene.value = frame;
    c.tBloom.value = bloomTex;
    c.uBloom.value = this.options.bloomStrength;
    c.uContrast.value = this.grade.contrast;
    c.uSaturation.value = this.grade.saturation;
    c.uGain.value = this.grade.gain;
    c.uLift.value = this.grade.lift;
    c.uVignette.value = this.options.vignette;
    c.uGrain.value = this.options.grain;
    c.uTime.value = this.time;
    (c.uRes.value as Vector2).set(w, h);
    this.draw(renderer, this.composite, null);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  private draw(renderer: WebGLRenderer, material: ShaderMaterial, out: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(out);
    renderer.render(this.quad, this.camera);
  }

  private ensureTargets(w: number, h: number): void {
    if (this.frame && this.frame.image.width === w && this.frame.image.height === h) return;
    this.disposeTargets();
    this.frame = new FramebufferTexture(w, h);
    this.frame.minFilter = LinearFilter;
    this.frame.magFilter = LinearFilter;
    if (!this.options.bloom) return;
    let bw = Math.max(1, w >> 1);
    let bh = Math.max(1, h >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.downs.push(target(bw, bh));
      if (i < BLOOM_LEVELS - 1) this.ups.push(target(bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
  }

  private disposeTargets(): void {
    this.frame?.dispose();
    this.frame = null;
    for (const t of this.downs) t.dispose();
    for (const t of this.ups) t.dispose();
    this.downs = [];
    this.ups = [];
  }

  dispose(): void {
    this.disposeTargets();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
