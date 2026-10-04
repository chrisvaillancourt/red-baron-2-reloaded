import {
  BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, TorusGeometry, Vector3,
} from 'three';
import type { DefenseWeaponId } from '../../core/defense';

const FORWARD = new Vector3(0, 0, -1);

/** Camera-space, real-metre foreground. The barrel is authored muzzle first:
 * its centreline runs from +Z (breech) to zero (muzzle), then along -Z.
 * Only the breech bolt recoils; neither the barrel nor the sight changes aim.
 */
export class BatteryWeapons {
  readonly object = new Group();
  readonly muzzle = new Vector3();
  readonly direction = new Vector3(0, 0, -1);
  private readonly stations = new Map<DefenseWeaponId, {
    root: Group; barrel: Group; bolt: Mesh; flash: Mesh; muzzle: Vector3; kick: number;
  }>();
  private selected: DefenseWeaponId = 'mg';

  constructor() {
    this.object.name = 'DefenseBatteryWeapons';
    const steel = new MeshStandardMaterial({ color: 0x343a36, metalness: 0.7, roughness: 0.38 });
    const paint = new MeshStandardMaterial({ color: 0x62634a, metalness: 0.25, roughness: 0.72 });
    const brass = new MeshStandardMaterial({ color: 0xa48b51, metalness: 0.75, roughness: 0.4 });
    const wood = new MeshStandardMaterial({ color: 0x57402b, roughness: 0.8 });
    const sightMat = new MeshStandardMaterial({ color: 0x242a27, metalness: 0.45, roughness: 0.5 });
    const boreMat = new MeshBasicMaterial({ color: 0x080a09 });
    const flashMat = new MeshBasicMaterial({ color: 0xffc16b, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
    const cube = new BoxGeometry(1, 1, 1);
    const cylinder = new CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2);
    const box = (parent: Group, x: number, y: number, z: number, w: number, h: number, d: number, material = paint) => {
      const mesh = new Mesh(cube, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      parent.add(mesh);
      return mesh;
    };
    for (const id of ['mg', 'cannon', 'flak'] as const) {
      const root = new Group();
      root.name = `DefenseStation_${id}`;
      const barrel = new Group();
      barrel.name = `DefenseBarrel_${id}`;
      const length = id === 'mg' ? 1.28 : id === 'cannon' ? 1.7 : 2.15;
      const radius = id === 'mg' ? 0.045 : id === 'cannon' ? 0.07 : 0.095;
      const muzzle = new Vector3(0, id === 'mg' ? -0.19 : -0.25, -(length + 0.85));
      root.add(barrel);
      const tube = new Mesh(cylinder, steel);
      tube.scale.set(radius, radius, length);
      tube.position.z = length / 2;
      barrel.add(tube);
      const bore = new Mesh(new CircleGeometry(radius * 0.72, 20), boreMat);
      bore.rotation.y = Math.PI;
      bore.position.z = -0.001;
      barrel.add(bore);
      const rim = new Mesh(new TorusGeometry(radius * 0.87, radius * 0.13, 6, 24), steel);
      barrel.add(rim);
      // The larger guns carry recoil cylinders below, never beside the aiming ray.
      if (id !== 'mg') {
        const recoil = new Mesh(cylinder, paint);
        recoil.scale.set(radius * 1.4, radius * 1.4, length * 0.55);
        recoil.position.set(0, -0.17, length * 0.65);
        barrel.add(recoil);
      } else {
        for (let i = 0; i < 13; i++) {
          const fin = new Mesh(new TorusGeometry(radius * 1.2, 0.008, 4, 16), steel);
          fin.position.z = 0.18 + i * 0.063;
          barrel.add(fin);
        }
        box(barrel, -0.19, -0.06, length, 0.25, 0.28, 0.4);
        for (let i = 0; i < 7; i++) box(barrel, -0.11 - i * 0.025, 0.04, length + 0.04, 0.018, 0.035, 0.12, brass);
      }
      box(barrel, 0, -0.045, length + 0.13, radius * 3.6, radius * 3, 0.4, steel);
      const bolt = box(barrel, radius * 1.9, 0.005, length + 0.12, 0.055, 0.045, 0.17, brass);
      bolt.userData.restZ = bolt.position.z;
      for (const x of [-0.22, 0.22]) {
        box(root, x, -0.45, -0.73, 0.065, 0.22, 0.08, wood);
        box(root, x * 0.55, -0.48, -0.95, 0.06, 0.34, 0.16);
      }
      box(root, 0, -0.79, -1.17, 0.23, 0.75, 0.3);
      // Two separate wings and a low sill leave the entire ring sight open.
      if (id !== 'mg') {
        for (const x of [-0.53, 0.53]) {
          const shield = box(root, x, -0.49, -1.48, 0.48, 0.63, 0.045);
          shield.rotation.y = x < 0 ? 0.13 : -0.13;
          for (const y of [-0.74, -0.24]) for (const dx of [-0.18, 0.18]) {
            box(root, x + dx, y, -1.448, 0.025, 0.025, 0.02, steel);
          }
        }
        box(root, 0, -0.84, -1.48, 1.45, 0.13, 0.05);
      }
      const sight = new Group();
      sight.name = `DefenseRingSight_${id}`;
      sight.position.z = -1.32;
      const ringRadius = id === 'mg' ? 0.086 : id === 'cannon' ? 0.095 : 0.11;
      sight.add(new Mesh(new TorusGeometry(ringRadius, 0.0035, 6, 48), sightMat));
      if (id === 'flak') sight.add(new Mesh(new TorusGeometry(ringRadius * 0.56, 0.002, 6, 40), sightMat));
      // Short radial ticks preserve an unobstructed central aiming aperture.
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const tick = box(sight, Math.sin(a) * ringRadius * 0.83, Math.cos(a) * ringRadius * 0.83, 0, 0.0025, ringRadius * 0.27, 0.003, sightMat);
        tick.rotation.z = -a;
      }
      box(sight, 0, -0.155, 0, 0.012, 0.13, 0.016, sightMat);
      root.add(sight);
      const flash = new Mesh(new CircleGeometry(radius * 2, 8), flashMat);
      flash.position.copy(muzzle);
      flash.visible = false;
      root.add(flash);
      root.visible = false;
      this.object.add(root);
      this.stations.set(id, { root, barrel, bolt, flash, muzzle, kick: 0 });
    }
    this.setAim('mg', 500);
  }

  setAim(id: DefenseWeaponId, range: number): void {
    this.selected = id;
    for (const [key, station] of this.stations) station.root.visible = key === id;
    const s = this.stations.get(id)!;
    this.muzzle.copy(s.muzzle);
    this.direction.set(0, 0, -range).sub(this.muzzle).normalize();
    s.barrel.position.copy(this.muzzle);
    s.barrel.quaternion.setFromUnitVectors(FORWARD, this.direction);
  }

  fire(id: DefenseWeaponId): void {
    this.stations.get(id)!.kick = 1;
  }

  update(dt: number): void {
    for (const [id, s] of this.stations) {
      s.kick = Math.max(0, s.kick - dt * 12);
      s.bolt.position.z = (s.bolt.userData.restZ as number) + s.kick * 0.07;
      s.flash.visible = id === this.selected && s.kick > 0.55;
    }
  }
}
