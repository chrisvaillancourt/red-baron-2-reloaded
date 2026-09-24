/**
 * Procedural ground-target models, one per GroundTargetType. Local frame:
 * origin on the ground, front toward -Z. Call setGroundTargetDestroyed()
 * when the entity dies (blackened, slumped).
 */
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Material,
} from 'three';
import type { GroundTargetType, Side } from '../../core/types';

const mats = {
  greyGerman: new MeshStandardMaterial({ color: 0x5f6352, roughness: 0.8, metalness: 0.2 }),
  khaki: new MeshStandardMaterial({ color: 0x6f6446, roughness: 0.8, metalness: 0.2 }),
  steel: new MeshStandardMaterial({ color: 0x3b3d3a, roughness: 0.5, metalness: 0.6 }),
  wood: new MeshStandardMaterial({ color: 0x6a5238, roughness: 0.9 }),
  canvas: new MeshStandardMaterial({ color: 0xa89c7a, roughness: 0.95, side: DoubleSide }),
  canvasDark: new MeshStandardMaterial({ color: 0x7c7560, roughness: 0.95, side: DoubleSide }),
  sandbag: new MeshStandardMaterial({ color: 0x9a8b68, roughness: 1 }),
  black: new MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.6, metalness: 0.4 }),
  red: new MeshStandardMaterial({ color: 0x5a2a20, roughness: 0.8 }),
  tyre: new MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }),
  burnt: new MeshStandardMaterial({ color: 0x191715, roughness: 1 }),
};

function box(w: number, h: number, d: number, m: Material, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(r: number, h: number, m: Material, seg = 10): Mesh {
  const mesh = new Mesh(new CylinderGeometry(r, r, h, seg), m);
  mesh.castShadow = true;
  return mesh;
}

function wheel(r: number, x: number, y: number, z: number, m: Material = mats.tyre, w = 0.2): Mesh {
  const c = cyl(r, w, m, 14);
  c.rotation.z = Math.PI / 2;
  c.position.set(x, y, z);
  return c;
}

function paint(side: Side): Material {
  return side === 'central' ? mats.greyGerman : mats.khaki;
}

function aaGun(side: Side): Group {
  const g = new Group();
  // Pedestal mount on a platform with sandbags.
  g.add(box(4, 0.3, 4, mats.wood));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = box(1.1, 0.5, 0.5, mats.sandbag, Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8);
    s.rotation.y = -a;
    g.add(s);
  }
  const ped = cyl(0.35, 1.2, paint(side));
  ped.position.y = 0.9;
  g.add(ped);
  const cradle = box(0.8, 0.5, 1.2, paint(side), 0, 1.4, 0);
  g.add(cradle);
  const barrel = cyl(0.08, 3.2, mats.steel, 8);
  barrel.position.set(0, 2.6, -1.0);
  barrel.rotation.x = -Math.PI / 3.2;
  g.add(barrel);
  const shield = box(1.5, 1.0, 0.06, paint(side), 0, 1.2, -0.7);
  g.add(shield);
  return g;
}

function truck(side: Side): Group {
  const g = new Group();
  const p = paint(side);
  g.add(box(1.9, 0.25, 6, mats.black, 0, 0.7, 0));
  g.add(box(1.7, 1.1, 1.5, p, 0, 0.95, -2.3)); // bonnet
  g.add(box(1.9, 1.4, 1.2, p, 0, 0.95, -1.1)); // cab
  const tilt = box(2.1, 1.9, 3.4, mats.canvas, 0, 0.95, 1.2);
  g.add(tilt);
  for (const z of [-2.1, 1.9]) for (const x of [-0.95, 0.95]) g.add(wheel(0.5, x, 0.5, z));
  return g;
}

function artillery(side: Side): Group {
  const g = new Group();
  const p = paint(side);
  g.add(wheel(0.65, -0.9, 0.65, 0, mats.wood, 0.12));
  g.add(wheel(0.65, 0.9, 0.65, 0, mats.wood, 0.12));
  const axle = cyl(0.06, 1.8, mats.steel);
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 0.65;
  g.add(axle);
  g.add(box(1.5, 1.2, 0.05, p, 0, 0.55, -0.35)); // shield
  const barrel = cyl(0.07, 2.4, mats.steel, 8);
  barrel.rotation.x = Math.PI / 2 - 0.12;
  barrel.position.set(0, 1.0, -1.1);
  g.add(barrel);
  const trail = box(0.3, 0.2, 2.6, p, 0, 0.2, 1.4);
  trail.rotation.x = 0.2;
  g.add(trail);
  // Gun pit with sandbag horseshoe and ammunition boxes.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.15 + (i / 8) * Math.PI * 1.7;
    const s = box(1.2, 0.6, 0.55, mats.sandbag, Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2 + 0.6);
    s.rotation.y = -a;
    g.add(s);
  }
  for (let i = 0; i < 4; i++) g.add(box(0.5, 0.35, 0.8, mats.wood, 2 + (i % 2) * 0.6, 0, 2 + Math.floor(i / 2) * 0.9));
  return g;
}

function hangar(side: Side): Group {
  const g = new Group();
  const wallMat = side === 'central' ? mats.wood : mats.canvasDark;
  g.add(box(22, 6, 2, wallMat, 0, 0, 12));
  g.add(box(2, 6, 24, wallMat, -11, 0, 0));
  g.add(box(2, 6, 24, wallMat, 11, 0, 0));
  const roof = new Mesh(new CylinderGeometry(12.5, 12.5, 26, 16, 1, true, -Math.PI / 2, Math.PI), side === 'central' ? mats.red : mats.canvasDark);
  roof.rotation.x = Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(1, 1, 0.4);
  roof.position.y = 6;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

function tentHangar(): Group {
  const g = new Group();
  const roof = new Mesh(new CylinderGeometry(10, 10, 22, 14, 1, true, -Math.PI / 2, Math.PI), mats.canvas);
  roof.rotation.x = Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(1, 1, 0.75);
  roof.position.y = 2.5;
  roof.castShadow = true;
  g.add(roof);
  g.add(box(20, 2.5, 0.1, mats.canvas, 0, 0, 11));
  return g;
}

function supplyDump(): Group {
  const g = new Group();
  for (let i = 0; i < 18; i++) {
    const x = (i % 6) * 1.6 - 4;
    const z = Math.floor(i / 6) * 2.2 - 2;
    const h = 0.6 + ((i * 7) % 3) * 0.6;
    g.add(box(1.4, h, 1.9, i % 4 === 0 ? mats.canvasDark : mats.wood, x, 0, z));
  }
  // Tarpaulin-covered stacks and shells.
  const tarp = new Mesh(new SphereGeometry(3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.canvasDark);
  tarp.scale.set(1.4, 0.6, 1);
  tarp.position.set(6, 0, 1);
  tarp.castShadow = true;
  g.add(tarp);
  for (let i = 0; i < 20; i++) {
    const s = cyl(0.1, 0.6, mats.steel, 6);
    s.position.set(-7 + (i % 10) * 0.25, 0.3, 3 + Math.floor(i / 10) * 0.25);
    g.add(s);
  }
  return g;
}

function trenchMg(side: Side): Group {
  const g = new Group();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI + (i / 9) * Math.PI;
    const s = box(0.9, 0.35, 0.45, mats.sandbag, Math.cos(a) * 1.6, (i % 2) * 0.35, Math.sin(a) * 1.6);
    s.rotation.y = -a;
    g.add(s);
    const s2 = box(0.9, 0.35, 0.45, mats.sandbag, Math.cos(a) * 1.6, 0.35 + (i % 2) * 0.35, Math.sin(a) * 1.6);
    s2.rotation.y = -a;
    g.add(s2);
  }
  const mg = box(0.12, 0.2, 1.1, mats.black, 0, 0.75, -1.2);
  g.add(mg);
  g.add(box(0.5, 0.35, 0.3, paint(side), 0, 0.5, -0.8));
  return g;
}

function train(side: Side): Group {
  const g = new Group();
  // Locomotive
  g.add(box(2.4, 0.4, 10, mats.black, 0, 0.9, 0));
  const boiler = cyl(0.9, 6.5, mats.black, 14);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 2.2, -1.5);
  g.add(boiler);
  g.add(box(2.5, 2.6, 2.6, mats.black, 0, 1.3, 3));
  const stack = cyl(0.3, 1.2, mats.black, 8);
  stack.position.set(0, 3.5, -4.2);
  g.add(stack);
  for (let i = 0; i < 4; i++) {
    g.add(wheel(0.7, -1.1, 0.7, -3.5 + i * 2.1, mats.steel, 0.15));
    g.add(wheel(0.7, 1.1, 0.7, -3.5 + i * 2.1, mats.steel, 0.15));
  }
  // Wagons
  for (let w = 0; w < 5; w++) {
    const z = 11 + w * 9;
    g.add(box(2.6, 2.4, 8, w % 2 ? mats.wood : paint(side), 0, 0.9, z));
    for (const dz of [-2.8, 2.8]) {
      g.add(wheel(0.45, -1.1, 0.45, z + dz, mats.steel, 0.12));
      g.add(wheel(0.45, 1.1, 0.45, z + dz, mats.steel, 0.12));
    }
  }
  return g;
}

export function createGroundTargetVisual(type: GroundTargetType, side: Side): Object3D {
  let g: Group;
  switch (type) {
    case 'aa-gun': g = aaGun(side); break;
    case 'truck': g = truck(side); break;
    case 'artillery': g = artillery(side); break;
    case 'hangar': g = hangar(side); break;
    case 'tent-hangar': g = tentHangar(); break;
    case 'supply-dump': g = supplyDump(); break;
    case 'trench-mg': g = trenchMg(side); break;
    case 'train': g = train(side); break;
  }
  g.name = `ground:${type}`;
  g.userData.targetType = type;
  return g;
}

/** Blacken and slump a destroyed ground target. */
export function setGroundTargetDestroyed(obj: Object3D): void {
  if (obj.userData.destroyed) return;
  obj.userData.destroyed = true;
  obj.traverse((o) => {
    if (o instanceof Mesh) o.material = mats.burnt;
  });
  obj.scale.y *= 0.55;
  obj.rotation.z += 0.08;
}
