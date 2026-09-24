/**
 * Free-fly QA harness for the world renderer (dev/world.html).
 * URL params: q, date, tod, cover, base, vis, town | x&z, alt, yaw, pitch, demo=1
 * Exposes window.__harness for Playwright.
 */
import { BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import type { BulletView, WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, BalloonEntity, GraphicsQuality, GroundTargetEntity, GroundTargetType, TimeOfDay, Weather } from '../../core/types';
import { AERODROMES } from '../../data/aerodromes';
import { sideOfFrontAt } from '../../world/frontline';
import { TOWNS_WORLD } from '../../world/landuse';
import { terrainHeightAt } from '../../world/terrain';
import { createWorldRenderer } from '../worldRenderer';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const quality = (params.get('q') ?? 'high') as GraphicsQuality;
let date = params.get('date') ?? '1917-06-01';
($<HTMLInputElement>('date')).value = date;

const world = createWorldRenderer(canvas, { quality, date });
const camera = new PerspectiveCamera(70, innerWidth / innerHeight, world.near, world.far);
const yawPitch = new Euler(0, 0, 0, 'YXZ');

// Debug: ?hide=sea,clouds,trees,towns,terrain,rivers,aerodromes,sky
for (const name of (params.get('hide') ?? '').split(',').filter(Boolean)) {
  const o = world.scene.getObjectByName(name);
  if (o) o.visible = false;
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  world.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// --- environment controls --------------------------------------------------------
const weather: Weather = {
  cloudCover: Number(params.get('cover') ?? 0.4),
  cloudBaseM: Number(params.get('base') ?? 1500),
  cloudTopM: 0,
  wind: [5, 0, 1.5],
  visibilityM: Number(params.get('vis') ?? 30000),
  turbulence: 0.2,
};
let tod = (params.get('tod') ?? 'morning') as TimeOfDay;
$<HTMLSelectElement>('tod').value = tod;
$<HTMLInputElement>('cover').value = String(weather.cloudCover);
$<HTMLInputElement>('base').value = String(weather.cloudBaseM);
$<HTMLInputElement>('vis').value = String(weather.visibilityM);

function applyEnv() {
  weather.cloudTopM = weather.cloudBaseM + 500 + weather.cloudCover * 1200;
  world.setEnvironment(date, tod, { ...weather });
}
applyEnv();
$('date').addEventListener('change', (e) => {
  date = (e.target as HTMLInputElement).value;
  applyEnv();
});
$('tod').addEventListener('change', (e) => {
  tod = (e.target as HTMLSelectElement).value as TimeOfDay;
  applyEnv();
});
for (const [id, key] of [['cover', 'cloudCover'], ['base', 'cloudBaseM'], ['vis', 'visibilityM']] as const) {
  $(id).addEventListener('change', (e) => {
    (weather as unknown as Record<string, number>)[key] = Number((e.target as HTMLInputElement).value);
    applyEnv();
  });
}

// --- teleport ------------------------------------------------------------------
const tp = $<HTMLSelectElement>('tp');
const places: { name: string; x: number; z: number }[] = [
  ...TOWNS_WORLD.filter((t) => t.size !== 'village' || ['Passchendaele', 'Thiepval', 'Vimy', 'Pozières', 'Bullecourt'].includes(t.name)).map((t) => ({ name: t.name, x: t.x, z: t.z })),
  ...AERODROMES.map((a) => ({ name: `✈ ${a.name}`, x: a.x, z: a.z })),
];
for (const p of places) {
  const o = document.createElement('option');
  o.textContent = p.name;
  tp.appendChild(o);
}
function teleport(x: number, z: number, alt: number, yawDeg = 0, pitchDeg = -12) {
  const g = terrainHeightAt(x, z);
  camera.position.set(x, Math.max(g + 2, g + alt), z);
  yawPitch.set((pitchDeg * Math.PI) / 180, (-yawDeg * Math.PI) / 180, 0);
  camera.quaternion.setFromEuler(yawPitch);
}
tp.addEventListener('change', () => {
  const p = places.find((q) => q.name === tp.value)!;
  teleport(p.x, p.z + 3000, Number($<HTMLInputElement>('alt').value), 0, -15);
});
const startTown = params.get('town') ?? 'Arras';
const sp = places.find((p) => p.name === startTown || p.name === `✈ ${startTown}`);
const sx = params.has('x') ? Number(params.get('x')) : (sp?.x ?? 0);
const sz = params.has('z') ? Number(params.get('z')) : (sp?.z ?? 0) + Number(params.get('back') ?? 3000);
teleport(sx, sz, Number(params.get('alt') ?? 800), Number(params.get('yaw') ?? 0), Number(params.get('pitch') ?? -12));
if (sp) tp.value = sp.name;

// --- input ---------------------------------------------------------------------
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyH') $('panel').classList.toggle('hidden');
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('click', () => canvas.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yawPitch.setFromQuaternion(camera.quaternion);
  yawPitch.y -= e.movementX * 0.0022;
  yawPitch.x = Math.max(-1.55, Math.min(1.55, yawPitch.x - e.movementY * 0.0022));
  camera.quaternion.setFromEuler(yawPitch);
});

// --- fake world ------------------------------------------------------------------
const aircraft: AircraftEntity[] = [];
const balloons: BalloonEntity[] = [];
const grounds: GroundTargetEntity[] = [];
const bullets: { position: Vector3; velocity: Vector3; tracer: boolean; side: 'allied' | 'central'; age: number }[] = [];
const placeholderMat = new MeshStandardMaterial({ color: 0x8a2a1e, roughness: 0.6 });
const placeholders = new Map<number, Group>();

function placeholderPlane(): Group {
  const g = new Group();
  const f = new Mesh(new BoxGeometry(0.8, 0.8, 6), placeholderMat);
  const w = new Mesh(new BoxGeometry(8, 0.1, 1.4), placeholderMat);
  w.position.y = 0.6;
  const w2 = w.clone();
  w2.position.y = -0.4;
  const t = new Mesh(new BoxGeometry(2.6, 0.1, 0.8), placeholderMat);
  t.position.z = 2.8;
  g.add(f, w, w2, t);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

let nextId = 1;
function spawnDemo() {
  const c = camera.position.clone();
  const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  const s = Number(params.get("ds") ?? 1);
  const center = c.clone().addScaledVector(fwd, 400 * s);
  // Two circling aircraft: one smoking, one on fire.
  for (let i = 0; i < 2; i++) {
    const ac = {
      id: nextId++,
      kind: 'aircraft',
      side: i ? 'central' : 'allied',
      state: { position: center.clone(), velocity: new Vector3(), onGround: false },
      damage: { smoking: i === 0, onFire: i === 1, engineDead: false },
      outcome: null,
    } as unknown as AircraftEntity;
    (ac as unknown as { orbit: { c: Vector3; r: number; w: number; a: number } }).orbit = { c: center.clone().add(new Vector3(0, i * 30, 0)), r: 140 + i * 60, w: 0.35 - i * 0.1, a: i * 2 };
    aircraft.push(ac);
    const ph = placeholderPlane();
    world.scene.add(ph);
    placeholders.set(ac.id, ph);
  }
  // Balloons of both sides and ground targets.
  const types: GroundTargetType[] = ['aa-gun', 'truck', 'artillery', 'hangar', 'tent-hangar', 'supply-dump', 'trench-mg', 'train'];
  for (let i = 0; i < 2; i++) {
    const bx = center.x + (i ? 250 : -250) * s;
    const bz = center.z - 300 * s;
    const gy = terrainHeightAt(bx, bz);
    const b: BalloonEntity = { id: nextId++, kind: 'balloon', side: i ? 'central' : 'allied', position: new Vector3(bx, gy + Math.max(60, 400 * s), bz), anchor: new Vector3(bx, gy, bz), health: 1, burning: false, destroyed: false, observerBailed: false };
    balloons.push(b);
    world.scene.add(world.createBalloonVisual(b));
  }
  types.forEach((t, i) => {
    const gx = center.x + (-280 + i * 80) * Math.max(0.3, s);
    const gz = center.z + 150 * s;
    const gy = terrainHeightAt(gx, gz);
    const o = world.createGroundTargetVisual(t, i % 2 ? 'central' : 'allied');
    o.position.set(gx, gy, gz);
    world.scene.add(o);
    grounds.push({ id: nextId++, kind: 'ground', type: t, side: 'allied', position: o.position.clone(), heading: 0, health: 1, destroyed: false });
  });
  // Flak field.
  for (let i = 0; i < 10; i++) world.handleEvent({ type: 'flak-burst', position: center.clone().add(new Vector3((Math.random() - 0.5) * 500, 150 + Math.random() * 200, (Math.random() - 0.5) * 500)) });
}
$('demo').addEventListener('click', spawnDemo);
$('flak').addEventListener('click', () => {
  const p = camera.position.clone().add(new Vector3(0, 0, -300).applyQuaternion(camera.quaternion));
  world.handleEvent({ type: 'flak-burst', position: p });
});
$('boom').addEventListener('click', () => {
  const p = camera.position.clone().add(new Vector3(0, 0, -250).applyQuaternion(camera.quaternion));
  p.y = terrainHeightAt(p.x, p.z) + 1;
  world.handleEvent({ type: 'explosion', position: p, size: 5 });
  world.handleEvent({ type: 'ground-destroyed', targetId: 0, killerId: null, position: p });
});
if (params.get('demo') === '1') setTimeout(spawnDemo, 50);

const worldQuery: WorldQuery = {
  get time() {
    return performance.now() / 1000;
  },
  date,
  aircraft,
  balloons,
  groundTargets: grounds,
  getEntity: (id) => [...aircraft, ...balloons, ...grounds].find((e) => e.id === id),
  groundHeightAt: terrainHeightAt,
  sideOfFrontAt: (x, z) => sideOfFrontAt(x, z, date),
  getFlight: () => undefined,
  env: { groundHeightAt: terrainHeightAt, airDensityAt: () => 1.2, windAt: (_p, out) => out.set(...weather.wind), turbulence: 0.2 },
};

// --- loop ------------------------------------------------------------------------
let last = performance.now();
let gunTimer = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = Number($<HTMLInputElement>('speed').value) * (keys.has('ShiftLeft') ? 5 : 1);
  const move = new Vector3(
    (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
    (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
  );
  if (move.lengthSq()) {
    move.normalize().multiplyScalar(speed * dt);
    const y = move.y;
    move.y = 0;
    move.applyQuaternion(camera.quaternion);
    move.y += y;
    camera.position.add(move);
    const g = terrainHeightAt(camera.position.x, camera.position.z);
    camera.position.y = Math.max(camera.position.y, g + 1.8);
  }
  // Animate fake aircraft.
  for (const ac of aircraft) {
    const o = (ac as unknown as { orbit: { c: Vector3; r: number; w: number; a: number } }).orbit;
    o.a += o.w * dt;
    const p = new Vector3(o.c.x + Math.cos(o.a) * o.r, o.c.y, o.c.z + Math.sin(o.a) * o.r);
    ac.state.velocity.copy(p).sub(ac.state.position).divideScalar(Math.max(dt, 1e-3));
    ac.state.position.copy(p);
    const ph = placeholders.get(ac.id)!;
    ph.position.copy(p);
    ph.lookAt(p.clone().sub(ac.state.velocity));
  }
  // Fake gunfire from the first aircraft.
  if (aircraft.length) {
    gunTimer -= dt;
    if (gunTimer <= 0) {
      gunTimer = 0.07;
      const a = aircraft[0];
      const dir = a.state.velocity.clone().normalize();
      bullets.push({ position: a.state.position.clone().addScaledVector(dir, 4), velocity: dir.multiplyScalar(800).add(a.state.velocity), tracer: bullets.length % 2 === 0, side: 'allied', age: 0 });
    }
    for (const b of bullets) {
      b.age += dt;
      b.velocity.y -= 9.8 * dt;
      b.position.addScaledVector(b.velocity, dt);
    }
    while (bullets.length && bullets[0].age > 2.5) bullets.shift();
  }
  camera.updateMatrixWorld();
  world.update(dt, camera, worldQuery, bullets as BulletView[]);
  world.render(camera);
  const s = world.stats();
  $('stats').textContent =
    `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms\n` +
    `calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
    `terrain ${s.terrainChunks} (+${s.terrainPending})  fx ${s.particles}\n` +
    `pos ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}\n` +
    `agl ${(camera.position.y - terrainHeightAt(camera.position.x, camera.position.z)).toFixed(0)} m  ${sideOfFrontAt(camera.position.x, camera.position.z, date)}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global {
  interface Window {
    __harness: unknown;
  }
}
window.__harness = {
  world,
  camera,
  teleport,
  spawnDemo,
  setEnv(d: string, t: TimeOfDay, cover: number, vis: number, base = 1500) {
    date = d;
    tod = t;
    weather.cloudCover = cover;
    weather.visibilityM = vis;
    weather.cloudBaseM = base;
    applyEnv();
  },
  stats: () => world.stats(),
  ready: () => world.whenReady(),
};
