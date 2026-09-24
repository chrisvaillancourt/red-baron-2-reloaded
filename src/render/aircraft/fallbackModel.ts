/**
 * Procedural fallback aircraft built from AircraftGeometry with plain
 * three.js geometry, used when a GLB is missing or fails to load. It follows
 * the same node-naming and UV-atlas contract as the Blender models
 * (docs/models.md), so liveries, animation and damage all still work.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Material,
} from 'three';
import type { AircraftSpec } from '../../core/types';
import { estimateMeta } from './meta';

const named = new Map<string, Material>();
function mat(name: string): Material {
  let m = named.get(name);
  if (!m) {
    m = new MeshStandardMaterial({ color: 0xffffff });
    m.name = name;
    named.set(name, m);
  }
  return m;
}

function mesh(name: string, geo: BufferGeometry, material: string): Mesh {
  const m = new Mesh(geo, mat(material));
  m.name = name;
  return m;
}

/** A box whose UVs follow a canvas mapping function of the vertex position. */
function mappedBox(sx: number, sy: number, sz: number, uv: (x: number, y: number, z: number) => [number, number]): BoxGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  const p = g.getAttribute('position');
  const arr: number[] = [];
  for (let i = 0; i < p.count; i++) arr.push(...uv(p.getX(i), p.getY(i), p.getZ(i)));
  g.setAttribute('uv', new Float32BufferAttribute(arr, 2));
  return g;
}

/** Lofted fuselage: rectangular-ish sections tapering to the sternpost. Body frame (fwd -Z). */
function fuselageGeometry(spec: AircraftSpec, noseZ: number, postZ: number, W: number, H: number): BufferGeometry {
  const N = 16;
  const stations = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const perim = 2 * (W + H) * 0.9;
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = noseZ + (postZ - noseZ) * t;
    const taper = Math.max(0, (t - 0.38) / 0.62);
    const w = (W / 2) * (1 - 0.9 * taper);
    const top = H / 2 - taper * H * 0.25;
    const bot = -H / 2 + taper * H * 0.5;
    for (let j = 0; j <= N; j++) {
      const th = (j / N) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      const x = w * Math.sign(s) * Math.abs(s) ** 0.5;
      const y = (top + bot) / 2 + ((top - bot) / 2) * Math.sign(c) * Math.abs(c) ** 0.5;
      pos.push(x, y, z);
      const half = j <= N / 2;
      const v = half ? 0.25 + ((j / N - 0.25) * 2 * (w + (top - bot) / 2)) / perim : 0.75 + ((j / N - 0.75) * 2 * (w + (top - bot) / 2)) / perim;
      uv.push(t, v);
    }
  }
  for (let i = 0; i < stations; i++)
    for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j, b = a + N + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  void spec;
  return g;
}

export function buildFallbackModel(spec: AircraftSpec): Object3D {
  const g = spec.geometry;
  const meta = estimateMeta(g);
  const root = new Group();
  root.name = `Aircraft_${spec.id}`;
  Object.assign(root.userData, meta, { aircraft_id: spec.id, fallback: true });
  const ext = new Group();
  ext.name = 'Exterior';
  root.add(ext);
  const W = g.fuselageWidth;
  const H = W * 1.2;
  const chord = g.chord;
  const upperLE = -0.3 * chord; // body frame: forward is -Z
  const noseZ = upperLE - 0.18 * g.length;
  const postZ = noseZ + meta.uv_fuselage_len;
  ext.add(mesh('Fuselage', fuselageGeometry(spec, noseZ, postZ, W, H), 'Livery_Fuselage'));

  const mono = g.layout === 'monoplane' || g.layout === 'parasol';
  const wings: { name: string; y: number; span: number; chord: number; le: number }[] = [];
  const lowY = -H / 2 + 0.05;
  if (mono) wings.push({ name: 'Main', y: g.layout === 'parasol' ? H / 2 + g.gap : H / 2 - 0.1, span: g.span, chord, le: upperLE });
  else {
    wings.push({ name: 'Lower', y: lowY, span: g.lowerSpan || g.span, chord: g.lowerChord || chord, le: upperLE + g.stagger });
    if (g.layout === 'triplane') wings.push({ name: 'Middle', y: lowY + g.gap, span: g.middleSpan || g.span, chord, le: upperLE + g.stagger / 2 });
    wings.push({ name: 'Upper', y: lowY + (g.layout === 'triplane' ? 2 : 1) * g.gap, span: g.span, chord, le: upperLE });
  }
  wings.forEach((w, i) => {
    const primaryTop = i === wings.length - 1 ? 0 : 0.5;
    const primaryBot = i === 0 ? 0 : 0.5;
    for (const side of [-1, 1] as const) {
      const half = w.span / 2;
      const geo = mappedBox(half, 0.07, w.chord, (x, y, z) => {
        const wx = side * half * 0.5 + x;
        const fa = (z + w.chord / 2) / meta.uv_chord_ref;
        return [0.5 + wx / meta.uv_span_ref, (y > 0 ? primaryTop : primaryBot) + 0.5 * fa];
      });
      // two material groups: top faces (+Y is box group 2) use WingTop, the rest WingBottom
      geo.clearGroups();
      geo.addGroup(0, 12, 1);
      geo.addGroup(12, 6, 0);
      geo.addGroup(18, 18, 1);
      const m = new Mesh(geo, [mat('Livery_WingTop'), mat('Livery_WingBottom')]);
      m.name = `Wing_${w.name}_${side > 0 ? 'R' : 'L'}`;
      m.position.set((side * half) / 2, w.y, w.le + w.chord / 2);
      ext.add(m);
    }
    if (i > 0) {
      for (const side of [-1, 1]) {
        const s = mesh('Struts', new BoxGeometry(0.03, g.gap, 0.08), 'Wood');
        s.position.set(side * (w.span / 2) * 0.8, w.y - g.gap / 2, w.le + w.chord * 0.4);
        ext.add(s);
      }
    }
  });
  const top = wings[wings.length - 1];
  for (const side of ['L', 'R'] as const) {
    const a = new Group();
    a.name = `Aileron_${side}`;
    a.position.set((side === 'R' ? 1 : -1) * top.span * 0.37, top.y, top.le + top.chord);
    ext.add(a);
  }
  // Tail
  const tailUV = (x: number, _y: number, z: number): [number, number] => [0.5 + x / meta.uv_tail_span, 0.5 + 0.5 * ((z - (postZ - 0.55)) / meta.uv_tail_chord)];
  const stab = mesh('Stabilizer_R', mappedBox(meta.uv_tail_span, 0.03, 0.55, tailUV), 'Livery_Tail');
  stab.position.set(0, H * 0.2, postZ - 0.28);
  ext.add(stab);
  const elev = new Group();
  elev.name = 'Elevator';
  elev.position.set(0, H * 0.2, postZ);
  const eMesh = mesh('Elevator_Mesh', mappedBox(meta.uv_tail_span, 0.03, 0.45, tailUV), 'Livery_Tail');
  eMesh.position.set(0, 0, 0.22);
  elev.add(eMesh);
  ext.add(elev);
  const rud = new Group();
  rud.name = 'Rudder';
  rud.position.set(0, H * 0.2, postZ);
  const rh = meta.uv_vtail_height;
  const rMesh = mesh('Rudder_Mesh', mappedBox(0.03, rh, meta.uv_rudder_chord, (_x, y, z) => [0.4 + 0.6 * ((z + meta.uv_rudder_chord / 2) / meta.uv_rudder_chord), 0.5 * (0.5 - y / rh)]), 'Livery_Tail');
  rMesh.position.set(0, rh / 2, meta.uv_rudder_chord / 2);
  rud.add(rMesh);
  ext.add(rud);
  // Engine + propeller
  const prop = new Group();
  prop.name = 'Propeller';
  prop.position.set(0, 0, noseZ - 0.1);
  const blades = mesh('PropBlades', new BoxGeometry(0.14, meta.prop_radius * 2, 0.03), 'Wood');
  prop.add(blades);
  ext.add(prop);
  const cowl = mesh('Cowling', new CylinderGeometry(W * 0.55, W * 0.55, 0.5, 16, 1, true), 'Livery_Cowling');
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 0, noseZ + 0.25);
  ext.add(cowl);
  // Gear
  const axleZ = upperLE + 0.2 - chord * 0.2;
  for (const side of [-1, 1]) {
    const w = mesh('Wheels', new CylinderGeometry(0.33, 0.33, 0.12, 14), 'Rubber');
    w.rotation.z = Math.PI / 2;
    w.position.set((side * g.wheelTrack) / 2, -H / 2 - 0.62, axleZ);
    ext.add(w);
  }
  // Crew + cockpit
  const cpZ = upperLE + chord + 0.1;
  const pilot = new Group();
  pilot.name = 'Pilot';
  const head = mesh('Pilot_Figure', new SphereGeometry(0.11, 10, 8), 'Pilot');
  head.position.set(0, H / 2 + 0.2, cpZ);
  pilot.add(head);
  root.add(pilot);
  const cockpit = new Group();
  cockpit.name = 'Cockpit';
  root.add(cockpit);
  const eye = new Object3D();
  eye.name = 'EyePoint';
  eye.position.set(0, H / 2 + 0.2, cpZ - 0.05);
  root.add(eye);
  const contacts: [string, number, number, number][] = [
    ['Contact_WheelL', -g.wheelTrack / 2, -H / 2 - 0.95, axleZ],
    ['Contact_WheelR', g.wheelTrack / 2, -H / 2 - 0.95, axleZ],
    ['Contact_Skid', 0, -0.2, postZ - 0.1],
  ];
  for (const [n, x, y, z] of contacts) {
    const o = new Object3D();
    o.name = n;
    o.position.set(x, y, z);
    root.add(o);
  }
  spec.guns.forEach((gm, i) => {
    const o = new Object3D();
    o.name = `Muzzle_${i}`;
    o.position.set(gm.position[0], gm.position[1], gm.position[2]);
    root.add(o);
  });
  return root;
}
