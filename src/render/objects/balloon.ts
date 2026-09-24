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

export function syncBalloonVisual(g: Group, b: BalloonEntity, time: number): void {
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
  const mat = g.userData.material as MeshStandardMaterial;
  if (b.burning || b.destroyed) {
    mat.color.copy(g.userData.baseColor as Color).multiplyScalar(0.25);
    mat.emissive.setRGB(0.8, 0.3, 0.05).multiplyScalar(b.destroyed ? 0.2 : 1);
    env.scale.y = Math.max(0.3, env.scale.y - 0.002);
  }
  if (b.destroyed) g.visible = b.position.y > b.anchor.y + 2;
}
