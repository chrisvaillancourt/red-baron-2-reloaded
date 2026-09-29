import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_LIST } from '../../data/aircraft';
import { crewStations } from '../../data/crew';
import { controlSurfaceAngles, insigniaSlots, metaFromUserData, roundelRings, rudderStripes } from './meta';
import { headingDeg } from './gauges';
import { buildFallbackModel } from './fallbackModel';
import { Quaternion } from 'three';

const MODELS = fileURLToPath(new URL('../../../public/models/', import.meta.url));
/** Mirrors of the generator's tables (tools/blender/aircraft_gen.py). */
const INTERNAL_BOMBS = new Set<string>(['handley_page_o400']); // bombs inside: no rack nodes
const PUSHER_NACELLES = new Set<string>(['gotha_gv']); // propellers behind the wings, not ahead of the CG

function parse(file: string): Promise<Object3D> {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab as ArrayBuffer, '', (g) => res(g.scene), rej));
}

describe('aircraft GLB models', () => {
  for (const spec of AIRCRAFT_LIST) {
    it(`${spec.id} follows the node/material/frame contract`, async () => {
      const file = `${MODELS}${spec.id}.glb`;
      expect(existsSync(file)).toBe(true);
      const scene = await parse(file);
      const root = scene.getObjectByName(`Aircraft_${spec.id}`)!;
      expect(root).toBeTruthy();
      const twin = (spec.performance.engineCount ?? 1) >= 2;
      const props = twin ? ['Propeller_L', 'Propeller_R', 'PropBlades_L', 'PropBlades_R', 'Engine_L', 'Engine_R'] : ['Propeller', 'PropBlades'];
      for (const n of ['Exterior', ...props, 'Elevator', 'Rudder', 'Pilot', 'Cockpit', 'EyePoint', 'Contact_WheelL', 'Contact_WheelR', 'Contact_Skid', 'Fuselage'])
        expect(root.getObjectByName(n), n).toBeTruthy();
      // Every gunner's station: its gun mount and its eye point (AircraftVisual.stationEyes).
      for (const st of crewStations(spec)) {
        if (st.id === 'pilot') continue;
        expect(root.getObjectByName(`Gun_${st.id}`), `Gun_${st.id}`).toBeTruthy();
        expect(root.getObjectByName(`EyePoint_${st.id}`), `EyePoint_${st.id}`).toBeTruthy();
        for (const g of st.guns) expect(root.getObjectByName(`Muzzle_${g}`)!.parent!.name, `Muzzle_${g}`).toMatch(new RegExp(`^Gun_${st.id}`));
      }
      // Bombs on racks, one mesh per bomb (the runtime merges each store); the O/400 carries its inside.
      if (spec.bombs && !INTERNAL_BOMBS.has(spec.id)) {
        spec.bombs.forEach((b, s) => {
          for (let k = 0; k < b.count; k++) expect(root.getObjectByName(`Bomb_${s}_${k}`), `Bomb_${s}_${k}`).toBeTruthy();
          expect(root.getObjectByName(`Bomb_${s}_${b.count}`)).toBeFalsy();
        });
      }
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
      const prop = root.getObjectByName(twin ? 'Propeller_R' : 'Propeller')!.getWorldPosition(new Vector3());
      if (twin) {
        // Nacelles where the spec puts them, their propellers clear of the fuselage.
        expect(prop.x).toBeCloseTo(spec.geometry.nacelleOffsetX!, 1);
        expect(prop.x - root.userData.prop_radius).toBeGreaterThan(spec.geometry.fuselageWidth / 2);
      }
      const skid = root.getObjectByName('Contact_Skid')!.getWorldPosition(new Vector3());
      const wheel = root.getObjectByName('Contact_WheelR')!.getWorldPosition(new Vector3());
      const eye = root.getObjectByName('EyePoint')!.getWorldPosition(new Vector3());
      if (!spec.geometry.pusher && !PUSHER_NACELLES.has(spec.id)) expect(prop.z).toBeLessThan(-0.5);
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

describe('procedural fallback model', () => {
  it('provides the same named nodes as the GLBs', () => {
    for (const spec of AIRCRAFT_LIST) {
      const root = buildFallbackModel(spec);
      for (const n of ['Exterior', 'Propeller', 'Elevator', 'Rudder', 'Aileron_L', 'Aileron_R', 'Pilot', 'Cockpit', 'EyePoint', 'Contact_Skid', 'Fuselage'])
        expect(root.getObjectByName(n), `${spec.id}:${n}`).toBeTruthy();
      for (let i = 0; i < spec.guns.length; i++) expect(root.getObjectByName(`Muzzle_${i}`)).toBeTruthy();
      expect(root.userData.uv_span_ref).toBe(spec.geometry.span);
    }
  });
});
