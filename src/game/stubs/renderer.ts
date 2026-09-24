/**
 * STUB world renderer: sky colour, fog, a terrain-following ground grid that
 * recentres on the camera, tracers and simple puffs for explosions/flak.
 * Replaced by src/render via src/game/modules.ts.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  type Camera,
  type Object3D,
} from 'three';
import type { WorldRenderer } from '../../core/interfaces';
import type { GameEvent, Side, TimeOfDay } from '../../core/types';
import { terrainHeightAt } from '../../world/terrain';
import type { WorldRendererOptions } from '../moduleTypes';

const SKY: Record<TimeOfDay, number> = {
  dawn: 0xe8b890,
  morning: 0x9cc4e8,
  midday: 0x88b8ec,
  afternoon: 0x9ab8d8,
  dusk: 0xd08a6a,
};

const GRID_SIZE = 24000;
const GRID_SEG = 160;
const MAX_TRACERS = 800;

interface Puff {
  mesh: Mesh;
  age: number;
  life: number;
  grow: number;
}

export function stubCreateWorldRenderer(canvas: HTMLCanvasElement, _opts: WorldRendererOptions): WorldRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new Scene();
  scene.background = new Color(SKY.midday);
  scene.fog = new Fog(SKY.midday, 2000, 18000);
  scene.add(new HemisphereLight(0xdfefff, 0x445522, 0.9));
  scene.add(new AmbientLight(0xffffff, 0.2));
  const sun = new DirectionalLight(0xfff2dd, 1.4);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);

  const groundGeo = new PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEG, GRID_SEG);
  groundGeo.rotateX(-Math.PI / 2);
  const colors = new Float32Array(groundGeo.attributes.position.count * 3);
  groundGeo.setAttribute('color', new BufferAttribute(colors, 3));
  const ground = new Mesh(groundGeo, new MeshLambertMaterial({ vertexColors: true }));
  scene.add(ground);
  let gridX = Number.NaN;
  let gridZ = Number.NaN;
  function rebuildGround(cx: number, cz: number) {
    const step = GRID_SIZE / GRID_SEG;
    gridX = Math.round(cx / step) * step;
    gridZ = Math.round(cz / step) * step;
    const pos = groundGeo.attributes.position as BufferAttribute;
    const base = new PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEG, GRID_SEG);
    base.rotateX(-Math.PI / 2);
    const bp = base.attributes.position as BufferAttribute;
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = bp.getX(i) + gridX;
      const z = bp.getZ(i) + gridZ;
      pos.setXYZ(i, x, terrainHeightAt(x, z), z);
      // Patchwork fields.
      const f = Math.sin(Math.floor(x / 400) * 12.9898 + Math.floor(z / 300) * 78.233) * 43758.5453;
      const r = f - Math.floor(f);
      c.setHSL(0.2 + r * 0.08, 0.35 + r * 0.2, 0.3 + r * 0.12);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    base.dispose();
    pos.needsUpdate = true;
    (groundGeo.attributes.color as BufferAttribute).needsUpdate = true;
    groundGeo.computeVertexNormals();
    groundGeo.computeBoundingSphere();
  }

  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerGeo = new BufferGeometry();
  tracerGeo.setAttribute('position', new BufferAttribute(tracerPos, 3));
  const tracers = new LineSegments(tracerGeo, new LineBasicMaterial({ color: 0xffdd88 }));
  tracers.frustumCulled = false;
  scene.add(tracers);

  const puffs: Puff[] = [];
  const puffGeo = new SphereGeometry(1, 8, 6);
  function spawnPuff(p: { x: number; y: number; z: number }, color: number, size: number, life: number, grow: number) {
    const m = new Mesh(puffGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.set(p.x, p.y, p.z);
    m.scale.setScalar(size);
    scene.add(m);
    puffs.push({ mesh: m, age: 0, life, grow });
  }
  let smokeTimer = 0;

  return {
    scene,
    renderer,
    setEnvironment(_date, tod, weather) {
      const col = SKY[tod] ?? SKY.midday;
      (scene.background as Color).setHex(col);
      (scene.fog as Fog).color.setHex(col);
      (scene.fog as Fog).far = Math.max(4000, weather.visibilityM);
    },
    update(dt, camera: Camera, world, bullets) {
      const cp = camera.position;
      if (Number.isNaN(gridX) || Math.hypot(cp.x - gridX, cp.z - gridZ) > 3000) rebuildGround(cp.x, cp.z);
      let n = 0;
      for (const b of bullets) {
        if (!b.tracer || n >= MAX_TRACERS) continue;
        const o = n * 6;
        tracerPos[o] = b.position.x;
        tracerPos[o + 1] = b.position.y;
        tracerPos[o + 2] = b.position.z;
        tracerPos[o + 3] = b.position.x - b.velocity.x * 0.02;
        tracerPos[o + 4] = b.position.y - b.velocity.y * 0.02;
        tracerPos[o + 5] = b.position.z - b.velocity.z * 0.02;
        n++;
      }
      tracerGeo.setDrawRange(0, n * 2);
      (tracerGeo.attributes.position as BufferAttribute).needsUpdate = true;

      smokeTimer += dt;
      if (smokeTimer > 0.1) {
        smokeTimer = 0;
        for (const a of world.aircraft) {
          if (a.damage.onFire) spawnPuff(a.state.position, 0xff7722, 1.5, 1.2, 3);
          else if (a.damage.smoking || a.damage.destroyed) spawnPuff(a.state.position, 0x333333, 1.5, 3, 2);
        }
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age += dt;
        p.mesh.scale.multiplyScalar(1 + p.grow * dt * 0.3);
        (p.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - p.age / p.life);
        if (p.age >= p.life) {
          scene.remove(p.mesh);
          (p.mesh.material as MeshBasicMaterial).dispose();
          puffs.splice(i, 1);
        }
      }
    },
    handleEvent(e: GameEvent) {
      switch (e.type) {
        case 'explosion':
          spawnPuff(e.position, 0xffaa33, e.size * 2, 1.5, 4);
          break;
        case 'flak-burst':
          spawnPuff(e.position, 0x222222, 4, 4, 1.5);
          break;
        case 'aircraft-destroyed':
          spawnPuff(e.position, 0xff8833, 4, 1.2, 4);
          break;
        case 'balloon-destroyed':
          spawnPuff(e.position, 0xff5500, 14, 3, 3);
          break;
        case 'bullet-impact-ground':
          spawnPuff(e.position, 0x8a7a5a, 0.8, 0.8, 2);
          break;
        default:
      }
    },
    render(camera) {
      renderer.render(scene, camera);
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
    },
    createBalloonVisual(): Object3D {
      const m = new Mesh(new SphereGeometry(1, 16, 12), new MeshLambertMaterial({ color: 0xb8a878 }));
      m.scale.set(8, 8, 18);
      return m;
    },
    createGroundTargetVisual(_type, side: Side): Object3D {
      return new Mesh(new BoxGeometry(6, 3, 8), new MeshLambertMaterial({ color: side === 'central' ? 0x556644 : 0x776655 }));
    },
    dispose() {
      for (const p of puffs) scene.remove(p.mesh);
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
    },
  };
}
