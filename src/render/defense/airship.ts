import {
  BoxGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group,
  LatheGeometry, Mesh, MeshStandardMaterial, Shape, TorusGeometry, Vector2,
} from 'three';

/** Rigid 120 m Zeppelin: faceted fabric envelope, cruciform tail and suspended
 * control/engine gondolas. It is deliberately not an AircraftEntity or plane GLB.
 */
export class DefenseAirship {
  readonly object = new Group();
  private readonly fabric = new MeshStandardMaterial({ color: 0xc5c1ad, roughness: 0.93, metalness: 0.03, side: DoubleSide });
  private readonly clean = new Color(0xc5c1ad);
  private readonly burnt = new Color(0x39352d);
  private readonly props: Group[] = [];

  constructor() {
    this.object.name = 'DefenseZeppelin';
    const metal = new MeshStandardMaterial({ color: 0x6c7268, roughness: 0.58, metalness: 0.4 });
    const seams = new MeshStandardMaterial({ color: 0x9c9c8e, roughness: 0.9 });
    const dark = new MeshStandardMaterial({ color: 0x242824, roughness: 0.55 });
    const glass = new MeshStandardMaterial({ color: 0x536c74, roughness: 0.2, metalness: 0.3 });
    const white = new MeshStandardMaterial({ color: 0xd9d5c8, roughness: 0.9 });
    const profile = [
      [0, -60], [3, -57], [7, -51], [10.3, -42], [12.4, -29], [13, -12],
      [13, 9], [12.2, 28], [10.1, 42], [6, 53], [1.5, 59], [0, 60],
    ];
    const envelope = new Mesh(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28).rotateX(Math.PI / 2), this.fabric);
    envelope.name = 'ZeppelinEnvelope';
    envelope.castShadow = true;
    this.object.add(envelope);
    // The narrow bands read as the ribs of the rigid framework, not balloon lobes.
    for (let i = 1; i < profile.length - 1; i++) {
      const [radius, z] = profile[i];
      const ring = new Mesh(new TorusGeometry(radius + 0.02, 0.06, 4, 28), seams);
      ring.position.z = z;
      this.object.add(ring);
    }
    const cube = new BoxGeometry(1, 1, 1);
    const box = (parent: Group, x: number, y: number, z: number, w: number, h: number, d: number, mat = metal) => {
      const mesh = new Mesh(cube, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const finShape = new Shape();
    finShape.moveTo(33, 6);
    finShape.lineTo(43, 19);
    finShape.lineTo(57, 19);
    finShape.lineTo(58, 2);
    finShape.closePath();
    const finGeo = new ExtrudeGeometry(finShape, { depth: 0.32, bevelEnabled: false, steps: 1 });
    // Shape X becomes body Z; shape Y is radial from the centreline.
    finGeo.rotateY(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const fin = new Mesh(finGeo, this.fabric);
      fin.rotation.z = i * Math.PI / 2;
      fin.castShadow = true;
      this.object.add(fin);
    }
    for (const z of [-28, 23]) {
      const gondola = new Group();
      gondola.name = z < 0 ? 'ControlGondola' : 'EngineGondola';
      gondola.position.set(0, -16, z);
      const hull = new Mesh(new CylinderGeometry(1.35, 1.1, 10, 8).rotateX(Math.PI / 2), metal);
      hull.scale.y = 0.8;
      hull.castShadow = true;
      gondola.add(hull);
      box(gondola, 0, 0.6, -1.6, 1.7, 1.2, 4.3);
      box(gondola, 0, 0.8, -3.78, 1.45, 0.6, 0.04, glass);
      for (const x of [-0.87, 0.87]) box(gondola, x, 0.8, -1.6, 0.04, 0.6, 3.7, glass);
      for (const x of [-0.9, 0.9]) for (const dz of [-3.5, 3.5]) {
        const strut = box(gondola, x, 2.5, dz, 0.12, 5, 0.12);
        strut.rotation.z = x * 0.12;
      }
      this.object.add(gondola);
    }
    for (const x of [-7, 7]) {
      const pod = new Group();
      pod.position.set(x, -12.2, 18);
      box(pod, 0, 0, 0, 1.7, 1.8, 5);
      box(pod, -x * 0.4, 0.4, -0.7, Math.abs(x) * 0.8, 0.16, 0.2);
      const prop = new Group();
      prop.position.z = 2.7;
      box(prop, 0, 0, 0, 0.27, 5.6, 0.11, dark);
      box(prop, 0, 0, 0, 5.6, 0.27, 0.11, dark);
      pod.add(prop);
      this.props.push(prop);
      this.object.add(pod);
    }
    // Period national cross panels on the envelope's flanks.
    for (const x of [-13.05, 13.05]) {
      box(this.object, x, 0, 6, 0.055, 6.6, 6.6, white);
      box(this.object, x * 1.003, 0, 6, 0.06, 5.6, 1.6, dark);
      box(this.object, x * 1.003, 0, 6, 0.06, 1.6, 5.6, dark);
    }
  }

  update(dt: number, damage: number, destroyed: boolean): void {
    this.fabric.color.copy(this.clean).lerp(this.burnt, destroyed ? 0.85 : damage * 0.45);
    for (const prop of this.props) prop.rotation.z += dt * (destroyed ? 4 : 65);
    if (destroyed) this.object.scale.y = Math.max(0.3, this.object.scale.y - dt * 0.035);
  }
}
