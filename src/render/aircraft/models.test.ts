import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST } from '../../data/aircraft';
import { controlSurfaceAngles, insigniaSlots, metaFromUserData, roundelRings, rudderStripes } from './meta';
import { headingDeg } from './gauges';
import { Quaternion } from 'three';

const MODELS = resolve(__dirname, '../../../public/models');

function parse(file: string): Promise<Object3D> {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab as ArrayBuffer, '', (g) => res(g.scene), rej));
}

describe('aircraft GLB models', () => {
  for (const spec of AIRCRAFT_LIST) {
    it(`${spec.id} follows the node/material/frame contract`, async () => {
      const file = resolve(MODELS, `${spec.id}.glb`);
      expect(existsSync(file)).toBe(true);
      const scene = await parse(file);
      const root = scene.getObjectByName(`Aircraft_${spec.id}`)!;
      expect(root).toBeTruthy();
      for (const n of ['Exterior', 'Propeller', 'Elevator', 'Rudder', 'Pilot', 'Cockpit', 'EyePoint', 'Contact_WheelL', 'Contact_WheelR', 'Contact_Skid', 'Fuselage'])
        expect(root.getObjectByName(n), n).toBeTruthy();
      if (spec.id !== 'fokker_eiii') {
        expect(root.getObjectByName('Aileron_L')).toBeTruthy();
        expect(root.getObjectByName('Aileron_R')).toBeTruthy();
      }
      for (let i = 0; i < spec.guns.length; i++) expect(root.getObjectByName(`Muzzle_${i}`), `Muzzle_${i}`).toBeTruthy();
      for (const g of ['Gauge_RPM', 'Gauge_Alt', 'Gauge_Speed', 'Gauge_Compass', 'Gauge_Fuel']) expect(root.getObjectByName(g), g).toBeTruthy();

      const mats = new Set<string>();
      let tris = 0;
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x.name));
        const idx = m.geometry.getIndex();
        tris += (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
      });
      for (const m of ['Livery_Fuselage', 'Livery_WingTop', 'Livery_WingBottom', 'Livery_Tail', 'Metal', 'Wood']) expect(mats.has(m), m).toBe(true);
      expect(tris).toBeGreaterThan(3000);
      expect(tris).toBeLessThan(12000);

      // Body frame: nose toward -Z, tail toward +Z, up +Y, span along X.
      root.updateMatrixWorld(true);
      const prop = root.getObjectByName('Propeller')!.getWorldPosition(new Vector3());
      const skid = root.getObjectByName('Contact_Skid')!.getWorldPosition(new Vector3());
      const wheel = root.getObjectByName('Contact_WheelR')!.getWorldPosition(new Vector3());
      const eye = root.getObjectByName('EyePoint')!.getWorldPosition(new Vector3());
      if (!spec.geometry.pusher) expect(prop.z).toBeLessThan(-0.5);
      expect(skid.z).toBeGreaterThan(2);
      expect(wheel.x).toBeGreaterThan(0.4);
      expect(wheel.y).toBeLessThan(-0.6);
      expect(eye.y).toBeGreaterThan(0.2);
      const box = new Box3().setFromObject(root.getObjectByName('Exterior')!);
      const size = box.getSize(new Vector3());
      expect(size.x).toBeGreaterThan(spec.geometry.span * 0.95);
      expect(size.x).toBeLessThan(spec.geometry.span * 1.08);
      expect(size.z).toBeGreaterThan(spec.geometry.length * 0.9);
      expect(size.z).toBeLessThan(spec.geometry.length * 1.12);

      const meta = metaFromUserData(root.userData, spec.geometry);
      expect(root.userData.uv_span_ref).toBeCloseTo(spec.geometry.span, 3);
      expect(meta.uv_fuselage_perim).toBeGreaterThan(1);
    });
  }
});

describe('livery & animation helpers', () => {
  it('uses historically ordered rudder stripes and roundels', () => {
    expect(rudderStripes('roundel-rfc')![0]).toMatch(/#2a3f/); // blue at the rudder post
    expect(rudderStripes('roundel-usa')![0]).toMatch(/#c12a/); // US: red leading
    expect(rudderStripes('iron-cross-patee')).toBeNull();
    expect(roundelRings('roundel-france')![2]).toMatch(/#2a3f/); // French: blue centre
    expect(roundelRings('roundel-rfc')![2]).toMatch(/#b324/); // British: red centre
    expect(roundelRings('roundel-usa')![2]).toMatch(/#f2ef/); // US 1918: white centre
    expect(insigniaSlots('balkenkreuz')).toContain('rudder');
  });

  it('deflects control surfaces the right way', () => {
    const a = controlSurfaceAngles({ pitch: 1, roll: 1, yaw: 1 });
    expect(a.aileronR).toBeLessThan(0); // right aileron trailing edge up in a right roll
    expect(a.aileronL).toBeGreaterThan(0);
    expect(a.elevator).toBeLessThan(0); // stick back: elevator up
    expect(a.rudder).toBeGreaterThan(0);
  });

  it('computes compass heading from orientation', () => {
    expect(headingDeg(new Quaternion())).toBeCloseTo(0, 5);
    const east = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    expect(headingDeg(east)).toBeCloseTo(90, 3);
  });
});
