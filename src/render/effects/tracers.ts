/**
 * Tracer streaks for live tracer bullets: camera-facing quads stretched
 * from the bullet back along its recent path, additive, with a minimum
 * on-screen width so distant tracers stay visible. Tails also follow the
 * camera's recent motion (see update()).
 */
import {
  NormalBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
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
  vec3 c = cross(axis, toCam);
  float cl = length(c);
  vec3 side = cl > 1e-5 ? c / cl : normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  // Screen-plane direction of travel; caps extend both ends along it so a
  // round flying straight away from the eye is still a glowing point, not
  // a degenerate zero-length quad.
  vec3 along = normalize(cross(toCam, side));
  if (dot(along, axis) < 0.0) along = -along;
  // ~1.5 px at any range so tracers read at a glance; small floor so the
  // muzzle end of a streak close to the camera stays a thin glow, not a bar.
  float w = max(0.02, d * 0.0028);
  p += side * position.y * w;
  p += along * (position.x * 2.0 - 1.0) * w * 1.2;
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
  // Premultiplied "over" with an emissive lift: glows on dark ground yet
  // still shows as orange (not washed out) against bright sky and cloud.
  gl_FragColor = vec4(col * 1.7 * a, a);
}`;

/** Seconds of flight path drawn behind each tracer round (~ visual persistence). */
export const TRACER_PERSISTENCE_S = 0.09;
const HISTORY = 24; // camera poses kept (≥ persistence at 240 fps)
const CUT_DISTANCE_M = 25;
const CUT_ANGLE_RAD = 0.45;

const tail = new Vector3();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();

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
      blending: NormalBlending,
      premultipliedAlpha: true,
      side: 2,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }

  /**
   * @param camera When given, streak tails are re-projected through the camera
   *   as it was when the tail point was seen (the eye's persistence), so rounds
   *   smear across the view as you turn: the "hosepipe" that makes your own
   *   tracers readable from the cockpit, where they otherwise converge to a dot.
   * @param dt Real frame time; 0 (paused) keeps the camera history frozen.
   */
  update(bullets: readonly BulletView[], camera?: Camera, dt = 0): void {
    const S = this.aStart.array as Float32Array;
    const E = this.aEnd.array as Float32Array;
    const H = this.aHeat.array as Float32Array;
    if (camera) this.recordCamera(camera, dt);
    let n = 0;
    for (const b of bullets) {
      if (!b.tracer || n >= this.cap) continue;
      // Streak = the path flown over the eye's persistence time, clamped to
      // the distance actually flown so young rounds trail back to the muzzle.
      const len = Math.min(TRACER_PERSISTENCE_S, b.age);
      E[n * 3] = b.position.x;
      E[n * 3 + 1] = b.position.y;
      E[n * 3 + 2] = b.position.z;
      tail.set(b.position.x - b.velocity.x * len, b.position.y - b.velocity.y * len, b.position.z - b.velocity.z * len);
      const m = camera ? this.persistenceMatrix(len) : null;
      if (m) tail.applyMatrix4(m);
      S[n * 3] = tail.x;
      S[n * 3 + 1] = tail.y;
      S[n * 3 + 2] = tail.z;
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

  // --- camera persistence ------------------------------------------------------

  private clock = 0;
  /** Ring of recent camera poses (world->view), newest last. */
  private readonly hist: { t: number; inv: Matrix4; pos: Vector3; quat: Quaternion; m: Matrix4 | null }[] = [];
  private readonly camNow = new Matrix4();

  private recordCamera(camera: Camera, dt: number): void {
    camera.updateMatrixWorld();
    this.camNow.copy(camera.matrixWorld);
    for (const h of this.hist) h.m = null; // cached products are per frame
    if (dt <= 0) return;
    this.clock += dt;
    const last = this.hist[this.hist.length - 1];
    camera.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    // A camera cut (view change, snap view, fly-by reposition) is not a head
    // movement the eye could follow: drop the history rather than smear.
    if (last && (last.pos.distanceTo(tmpPos) > CUT_DISTANCE_M || last.quat.angleTo(tmpQuat) > CUT_ANGLE_RAD)) this.hist.length = 0;
    const slot = this.hist.length >= HISTORY ? this.hist.shift()! : { t: 0, inv: new Matrix4(), pos: new Vector3(), quat: new Quaternion(), m: null };
    slot.t = this.clock;
    slot.inv.copy(camera.matrixWorldInverse);
    slot.pos.copy(tmpPos);
    slot.quat.copy(tmpQuat);
    slot.m = null;
    this.hist.push(slot);
  }

  /** camNow · camThen⁻¹ for the pose `ago` seconds back (null when there is no history). */
  private persistenceMatrix(ago: number): Matrix4 | null {
    if (this.hist.length < 2) return null;
    const want = this.clock - ago;
    let h = this.hist[0];
    for (const e of this.hist) {
      if (e.t > want) break;
      h = e;
    }
    if (!h.m) h.m = new Matrix4().multiplyMatrices(this.camNow, h.inv);
    return h.m;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
