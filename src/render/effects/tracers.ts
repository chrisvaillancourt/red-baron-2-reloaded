/**
 * Tracer streaks for live tracer bullets: camera-facing quads stretched
 * from the bullet back along its velocity, additive, with a minimum on-screen
 * width so distant tracers stay visible.
 */
import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Float32BufferAttribute } from 'three';
import type { BulletView } from '../../core/interfaces';

const VERT = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute float iHeat;
varying float vAlong;
varying float vSide;
varying float vHeat;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = mix(iStart, iEnd, position.x);
  vec3 axis = iEnd - iStart;
  vec3 toCam = cameraPosition - p;
  float d = length(toCam);
  vec3 side = normalize(cross(axis, toCam));
  float w = max(0.09, d * 0.0011);
  p += side * position.y * w;
  vAlong = position.x;
  vSide = position.y;
  vHeat = iHeat;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
varying float vAlong;
varying float vSide;
varying float vHeat;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float core = 1.0 - abs(vSide);
  float a = core * core * (0.25 + 0.75 * vAlong) * vHeat;
  vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.6), core * vAlong);
  gl_FragColor = vec4(col * 2.2 * a, a);
}`;

export class Tracers {
  readonly mesh: Mesh;
  private readonly geo = new InstancedBufferGeometry();
  private readonly aStart: InstancedBufferAttribute;
  private readonly aEnd: InstancedBufferAttribute;
  private readonly aHeat: InstancedBufferAttribute;

  constructor(private readonly cap = 2000) {
    // Quad: x in {0,1} along, y in {-1,1} side.
    this.geo.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aStart = mk(3);
    this.aEnd = mk(3);
    this.aHeat = mk(1);
    this.geo.setAttribute('iStart', this.aStart);
    this.geo.setAttribute('iEnd', this.aEnd);
    this.geo.setAttribute('iHeat', this.aHeat);
    this.geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }

  update(bullets: readonly BulletView[]): void {
    const S = this.aStart.array as Float32Array;
    const E = this.aEnd.array as Float32Array;
    const H = this.aHeat.array as Float32Array;
    let n = 0;
    for (const b of bullets) {
      if (!b.tracer || n >= this.cap) continue;
      const len = 0.035; // seconds of travel drawn
      E[n * 3] = b.position.x;
      E[n * 3 + 1] = b.position.y;
      E[n * 3 + 2] = b.position.z;
      S[n * 3] = b.position.x - b.velocity.x * len;
      S[n * 3 + 1] = b.position.y - b.velocity.y * len;
      S[n * 3 + 2] = b.position.z - b.velocity.z * len;
      // Tracer compound burns out after ~2.5 s.
      H[n] = Math.max(0, 1 - Math.max(0, b.age - 1.8) / 0.7);
      n++;
    }
    this.geo.instanceCount = n;
    for (const a of [this.aStart, this.aEnd, this.aHeat]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
