/**
 * STUB aircraft visual: boxes for fuselage, wings, tail and a spinning
 * propeller, coloured from the livery. Replaced by src/render/aircraft.
 */
import { BoxGeometry, Group, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import type { AircraftVisual } from '../../core/interfaces';
import type { AircraftEntity, AircraftSpec, Livery } from '../../core/types';

export async function stubCreateAircraftVisual(spec: AircraftSpec, livery: Livery): Promise<AircraftVisual> {
  const g = spec.geometry;
  const root = new Group();
  const body = new Group();
  root.add(body);
  const mat = (c: string) => new MeshLambertMaterial({ color: c });
  const fus = new Mesh(new BoxGeometry(g.fuselageWidth, g.fuselageWidth, g.length), mat(livery.fuselage));
  fus.position.z = g.length * 0.1;
  body.add(fus);
  const wingMat = mat(livery.wingTop);
  const wings: [number, number, number][] = []; // span, chord, y
  if (g.layout === 'monoplane') wings.push([g.span, g.chord, 0]);
  else if (g.layout === 'parasol') wings.push([g.span, g.chord, 0.9]);
  else if (g.layout === 'triplane') {
    wings.push([g.span, g.chord, g.gap * 1.5], [g.middleSpan || g.span, g.chord, g.gap * 0.5], [g.lowerSpan, g.lowerChord, -g.gap * 0.5]);
  } else wings.push([g.span, g.chord, g.gap * 0.7], [g.lowerSpan, g.lowerChord, -g.gap * 0.3]);
  for (const [span, chord, y] of wings) {
    const w = new Mesh(new BoxGeometry(span, 0.08, chord), wingMat);
    w.position.set(0, y, -g.length * 0.18);
    body.add(w);
  }
  const tail = new Mesh(new BoxGeometry(g.span * 0.35, 0.06, 0.9), mat(livery.tail));
  tail.position.set(0, 0.1, g.length * 0.48);
  body.add(tail);
  const fin = new Mesh(new BoxGeometry(0.06, 0.9, 0.8), mat(livery.tail));
  fin.position.set(0, 0.5, g.length * 0.5);
  body.add(fin);
  const prop = new Mesh(new BoxGeometry(2.4, 0.15, 0.05), mat('#4a3520'));
  prop.position.set(0, 0, g.pusher ? g.length * 0.05 : -g.length * 0.42);
  body.add(prop);
  const eyePoint = new Vector3(0, g.fuselageWidth * 0.6 + 0.35, g.length * 0.05);

  return {
    object: root,
    eyePoint,
    update(ac: AircraftEntity, dt: number) {
      root.position.copy(ac.state.position);
      root.quaternion.copy(ac.state.orientation);
      prop.rotation.z += (ac.state.engineRpm / 60) * Math.PI * 2 * dt * 0.25;
    },
    setCockpitView(enabled: boolean) {
      fus.visible = !enabled;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        (m.material as MeshLambertMaterial | undefined)?.dispose?.();
      });
    },
  };
}

export async function stubPreloadAircraftModels(): Promise<void> {}
