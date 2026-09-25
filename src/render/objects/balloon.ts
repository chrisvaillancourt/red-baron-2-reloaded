/**
 * Observation kite balloons: the Allied Caquot (three inflated tail lobes)
 * and the German Drachen (Parseval–Sigsfeld sausage with a single
 * steering bag). Includes rigging, the observer's basket and the tether to
 * the winch. syncBalloonVisual() keeps it in step with its entity.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  Float32BufferAttribute,
  BoxGeometry,
} from 'three';
import type { BalloonEntity } from '../../core/types';

const fabricAllied = new MeshStandardMaterial({ color: 0xb2a98c, roughness: 0.75 });
const fabricGerman = new MeshStandardMaterial({ color: 0xa39c86, roughness: 0.75 });
const basketMat = new MeshStandardMaterial({ color: 0x5d4a32, roughness: 0.95 });
const ropeMat = new LineBasicMaterial({ color: 0x2a2620 });

function envelopeProfile(length: number, radius: number, noseFat: number): Vector2[] {
  // Lathe profile along +Y from tail (0) to nose (length); rotated later so the nose faces -Z.
  const pts: Vector2[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Teardrop: fat at the nose, tapering to the tail.
    const r = radius * Math.sin(Math.PI * Math.pow(t, 0.9)) ** 0.65 * (0.55 + noseFat * t);
    pts.push(new Vector2(Math.max(0.01, r), t * length));
  }
  return pts;
}

export function createBalloonVisual(b: BalloonEntity): Group {
  const g = new Group();
  g.name = `balloon:${b.id}`;
  const body = new Group();
  body.name = 'envelope';
  g.add(body);
  const caquot = b.side === 'allied';
  const mat = caquot ? fabricAllied.clone() : fabricGerman.clone();
  if (caquot) {
    const env = new Mesh(new LatheGeometry(envelopeProfile(28, 5.2, 0.6), 24), mat);
    env.rotation.x = -Math.PI / 2;
    env.position.z = 14;
    env.castShadow = true;
    body.add(env);
    // Three tail lobes (top, and two lower at ±120°).
    const lobeGeo = new SphereGeometry(1, 16, 10);
    lobeGeo.scale(1.6, 1.6, 4.2);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const lobe = new Mesh(lobeGeo, mat);
      lobe.position.set(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 11);
      lobe.rotation.set(-Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0);
      lobe.castShadow = true;
      body.add(lobe);
    }
  } else {
    // Drachen: long sausage with hemispherical ends and a curved steering bag.
    const L = 24, R = 4.2;
    const cyl = new Mesh(new CylinderGeometry(R, R, L, 24, 1, true), mat);
    cyl.rotation.x = Math.PI / 2;
    const n1 = new Mesh(new SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    n1.rotation.x = -Math.PI / 2;
    n1.position.z = -L / 2;
    const n2 = n1.clone();
    n2.rotation.x = Math.PI / 2;
    n2.position.z = L / 2;
    body.add(cyl, n1, n2);
    body.rotation.x = -0.35; // nose-up attitude
    const bagCurve = new CatmullRomCurve3([new Vector3(0, -R * 0.4, L * 0.1), new Vector3(0, -R * 1.25, L * 0.45), new Vector3(0, -R * 0.2, L * 0.62)]);
    const bag = new Mesh(new TubeGeometry(bagCurve, 16, 1.4, 10, false), mat);
    body.add(bag);
    body.children.forEach((m) => (m.castShadow = true));
  }
  // Basket and rigging below.
  const basket = new Mesh(new BoxGeometry(1.1, 1.0, 1.1), basketMat);
  basket.position.set(0, -12, 0);
  basket.name = 'basket';
  g.add(basket);
  const rig: number[] = [];
  for (const [x, z] of [[-3, -8], [3, -8], [-3, 6], [3, 6], [0, -12], [0, 10]]) rig.push(x, -3.5, z, 0, -11.5, 0);
  const rg = new BufferGeometry();
  rg.setAttribute('position', new Float32BufferAttribute(rig, 3));
  g.add(new LineSegments(rg, ropeMat));
  // Tether (unit length along -Y, scaled to the anchor each sync).
  const tg = new BufferGeometry();
  tg.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, -1, 0], 3));
  const tether = new Line(tg, ropeMat);
  tether.name = 'tether';
  tether.position.set(0, -12, 0);
  tether.frustumCulled = false;
  g.add(tether);
  g.userData.material = mat;
  g.userData.baseColor = mat.color.clone();
  syncBalloonVisual(g, b, 0);
  return g;
}

const tmp = new Vector3();
const canopyMat = new MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8, side: 2 });
const figureMat = new MeshStandardMaterial({ color: 0x3a3428, roughness: 0.9 });

/** Observer under a static-line parachute (Heinecke / "Guardian Angel"), world-space. */
function createParachute(): Group {
  const p = new Group();
  p.name = 'parachute';
  const canopy = new Mesh(new SphereGeometry(3.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), canopyMat);
  canopy.scale.y = 0.6;
  canopy.position.y = 7;
  p.add(canopy);
  const lines: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lines.push(Math.cos(a) * 3, 7.2, Math.sin(a) * 3, 0, 0.9, 0);
  }
  const lg = new BufferGeometry();
  lg.setAttribute('position', new Float32BufferAttribute(lines, 3));
  p.add(new LineSegments(lg, ropeMat));
  const fig = new Mesh(new BoxGeometry(0.45, 1.7, 0.35), figureMat);
  fig.position.y = 0;
  p.add(fig);
  return p;
}

/** Seconds a flamed balloon takes to burn out; the wreck falls meanwhile. */
export const BALLOON_BURN_TIME = 16;

/**
 * Burn phase of a flamed balloon visual: time since ignition, how far the
 * burning wreck has fallen (m) and fire intensity (1 → 0). Null if not burning.
 */
export function balloonBurnState(g: Group): { t: number; fall: number; intensity: number; pos: Vector3 } | null {
  const u = g.userData as { burnT0?: number; burnT?: number; fall?: number };
  if (u.burnT0 === undefined) return null;
  const t = u.burnT ?? 0;
  return { t, fall: u.fall ?? 0, intensity: Math.max(0, 1 - t / BALLOON_BURN_TIME) * (t < 1.5 ? 1 : 0.8), pos: g.position };
}

export function syncBalloonVisual(g: Group, b: BalloonEntity, time: number, groundY = b.anchor.y): void {
  const u = g.userData as { burnT0?: number; burnT?: number; fall?: number; chute?: Group; chuteY?: number };
  // Observer's parachute: leaves the basket when he bails out, drifts down, lands.
  if (b.observerBailed && !u.chute && g.parent) {
    u.chute = createParachute();
    u.chute.position.set(b.position.x + 2, b.position.y - 14, b.position.z);
    u.chuteY = u.chute.position.y;
    g.parent.add(u.chute);
  }
  if (u.chute && u.chuteY !== undefined) {
    const dt = u.chute.userData.lastT === undefined ? 0 : time - u.chute.userData.lastT;
    u.chute.userData.lastT = time;
    const gy = groundY;
    u.chuteY = Math.max(gy + 0.9, u.chuteY - dt * 5.5);
    u.chute.position.y = u.chuteY;
    u.chute.position.x += dt * 2;
    u.chute.rotation.z = Math.sin(time * 1.3) * 0.08;
    // Collapsed canopy on the ground; removed after a while.
    const landed = u.chuteY <= gy + 0.95;
    u.chute.children[0].scale.set(1, landed ? 0.08 : 0.6, 1);
    if (landed && (u.chute.userData.landT ??= time) < time - 60) u.chute.visible = false;
  }
  if (b.burning && u.burnT0 === undefined) {
    u.burnT0 = time;
    u.fall = 0;
  }
  if (u.burnT0 !== undefined) {
    // Burning wreck: hydrogen flash, envelope shrivels, the lot falls (accelerating, ~25 m/s cap).
    const t = time - u.burnT0;
    u.burnT = t;
    const tf = Math.max(0, t - 1.2);
    u.fall = Math.min(tf < 2.5 ? 2 * tf * tf : 12.5 + (tf - 2.5) * 25, b.position.y - groundY);
    g.position.set(b.position.x, b.position.y - u.fall, b.position.z);
    const env = g.getObjectByName('envelope')!;
    const shrink = Math.max(0.12, 1 - t / 4);
    env.scale.set(shrink, shrink * 0.8, Math.max(0.2, shrink));
    const mat = g.userData.material as MeshStandardMaterial;
    mat.color.copy(g.userData.baseColor as Color).multiplyScalar(0.12);
    mat.emissive.setRGB(1, 0.35, 0.06).multiplyScalar(Math.max(0, 1.4 - t / 5));
    g.getObjectByName('tether')!.visible = false;
    g.visible = t < BALLOON_BURN_TIME && g.position.y > groundY + 1;
    return;
  }
  g.position.copy(b.position);
  // Weather-vane gently and bob on the cable.
  const env = g.getObjectByName('envelope')!;
  env.rotation.z = Math.sin(time * 0.4 + b.id) * 0.04;
  g.rotation.y = Math.sin(time * 0.05 + b.id * 2) * 0.2;
  const tether = g.getObjectByName('tether')!;
  tmp.copy(b.anchor).sub(b.position);
  const len = Math.max(1, -tmp.y - 12);
  tether.scale.set(1, len, 1);
  tether.visible = !b.destroyed;
  if (b.destroyed) g.visible = false; // destroyed without burning (hauled down)
}
