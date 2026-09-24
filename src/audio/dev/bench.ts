/** Interactive audio test bench (dev/audio.html). */
import { PerspectiveCamera, Vector3 } from 'three';
import type { BulletView, MusicCue } from '../../core/interfaces';
import type { AircraftId, GameEvent, GunType } from '../../core/types';
import { AIRCRAFT_LIST, GUNS } from '../../data/aircraft';
import { WebAudioEngine } from '../audioEngine';
import { mockAircraft, mockWorld } from './mockWorld';
import { runSelfTest } from './selftest';

const audio = new WebAudioEngine();
const tap = audio.debugTap();
const camera = new PerspectiveCamera(70, 1, 0.1, 10000);

let player = mockAircraft(1, 'sopwith_camel', 'allied');
const flyby = mockAircraft(2, 'albatros_dv', 'central');
flyby.controls.throttle = 1;
const circlers = [3, 4, 5, 6, 7, 8].map((id, i) => mockAircraft(id, (['fokker_dri', 'albatros_diii', 'pfalz_diiia', 'fokker_dvii', 'halberstadt_clii', 'rumpler_civ'] as AircraftId[])[i], 'central'));
const aircraft = [player, flyby, ...circlers];
const world = mockWorld(aircraft);

const params = {
  rpm: 1250, throttle: 0.8, airspeed: 50, vy: 0, damage: 0, blip: false, dead: false,
  stalled: false, onGround: false, fire: false, cockpit: true, flyby: false, circlers: false, enemyGuns: false,
};

const $ = (id: string) => document.getElementById(id)!;
const status = $('status');
const meter = $('meter').firstElementChild as HTMLDivElement;

function button(parent: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { void audio.resume(); onClick(); };
  $(parent).appendChild(b);
  return b;
}

function slider(parent: string, label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): void {
  const l = document.createElement('label');
  const s = document.createElement('input');
  s.type = 'range'; s.min = String(min); s.max = String(max); s.step = String(step); s.value = String(value);
  const out = document.createElement('span');
  out.textContent = String(value);
  s.oninput = () => { onInput(Number(s.value)); out.textContent = s.value; };
  l.append(label, s, out);
  $(parent).appendChild(l);
}

function check(parent: string, label: string, key: keyof typeof params): void {
  const l = document.createElement('label');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = params[key] as boolean;
  c.onchange = () => { (params as Record<string, unknown>)[key] = c.checked; void audio.resume(); };
  l.append(c, label);
  $(parent).appendChild(l);
}

function emit(e: GameEvent): void {
  audio.handleEvent(e, camera.position);
}

// --- Controls ---------------------------------------------------------------
$('start').onclick = async () => { await audio.resume(); audio.warmUp(); };

let vol = { master: 0.8, music: 0.6, fx: 0.9 };
const applyVol = () => audio.setVolumes(vol.master, vol.music, vol.fx);
slider('volumes', 'master', 0, 1, 0.05, vol.master, (v) => { vol.master = v; applyVol(); });
slider('volumes', 'music', 0, 1, 0.05, vol.music, (v) => { vol.music = v; applyVol(); });
slider('volumes', 'effects', 0, 1, 0.05, vol.fx, (v) => { vol.fx = v; applyVol(); });
applyVol();

for (const cue of ['menu', 'briefing', 'flight', 'victory', 'defeat', 'medal', 'none'] as MusicCue[]) button('music', cue, () => audio.playMusic(cue));
for (const s of ['click', 'hover', 'confirm', 'back', 'typewriter', 'stamp'] as const) button('ui', s, () => audio.playUi(s));
button('ui', 'type a line', () => { for (let i = 0; i < 14; i++) setTimeout(() => audio.playUi('typewriter'), i * (70 + Math.random() * 60)); });

const select = document.createElement('select');
for (const s of AIRCRAFT_LIST) {
  const o = document.createElement('option');
  o.value = s.id; o.textContent = `${s.name} (${s.performance.engineName})`;
  if (s.id === player.spec.id) o.selected = true;
  select.appendChild(o);
}
select.onchange = () => {
  const next = mockAircraft(1, select.value as AircraftId, 'allied');
  aircraft[0] = next;
  player = next;
};
$('player').appendChild(select);
slider('player', 'rpm', 0, 2200, 10, params.rpm, (v) => (params.rpm = v));
slider('player', 'throttle', 0, 1, 0.01, params.throttle, (v) => (params.throttle = v));
slider('player', 'airspeed m/s', 0, 110, 1, params.airspeed, (v) => (params.airspeed = v));
slider('player', 'vert speed', -60, 20, 1, params.vy, (v) => (params.vy = v));
slider('player', 'engine damage', 0, 1, 0.05, params.damage, (v) => (params.damage = v));
check('player', 'blip switch', 'blip');
check('player', 'engine dead', 'dead');
check('player', 'stalled', 'stalled');
check('player', 'on ground', 'onGround');
check('player', 'on fire', 'fire');
check('player', 'cockpit view', 'cockpit');

// --- Guns -------------------------------------------------------------------
for (const g of ['vickers', 'spandau', 'lewis', 'parabellum'] as GunType[]) {
  const b = button('guns', g, () => {});
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => { if (timer) clearInterval(timer); timer = null; b.classList.remove('active'); };
  b.onpointerdown = () => {
    void audio.resume();
    b.classList.add('active');
    const enemy = params.enemyGuns;
    const period = 60000 / GUNS[g].rpmSynchronized;
    const fire = () => emit({ type: 'gun-fired', shooterId: enemy ? 2 : 1, gun: g, position: (enemy ? flyby : player).state.position.clone() });
    fire();
    timer = setInterval(fire, period);
  };
  b.onpointerup = stop;
  b.onpointerleave = stop;
}
check('guns', 'fired by the fly-by aircraft', 'enemyGuns');

// --- Own aircraft -----------------------------------------------------------
const P = () => player.state.position.clone();
for (const zone of ['leftWing', 'fuselage', 'engine', 'pilot', 'tail'] as const) {
  button('own', `hit ${zone}`, () => emit({ type: 'bullet-hit', targetId: 1, shooterId: 2, position: P(), zone }));
}
button('own', 'burst of hits', () => {
  const zones = ['leftWing', 'rightWing', 'fuselage', 'tail', 'engine', 'fuselage'] as const;
  zones.forEach((zone, i) => setTimeout(() => emit({ type: 'bullet-hit', targetId: 1, shooterId: 2, position: P(), zone }), i * 70));
});
button('own', 'jam', () => { player.guns[0].jammed = true; emit({ type: 'gun-jammed', aircraftId: 1, mountIndex: 0 }); });
button('own', 'hammer (clearJam press)', () => {
  player.guns[0].jammed = true;
  player.controls.clearJam = true;
  setTimeout(() => (player.controls.clearJam = false), 80);
});
button('own', 'cleared', () => { player.guns[0].jammed = false; emit({ type: 'gun-cleared', aircraftId: 1, mountIndex: 0 }); });
button('own', 'Lewis drum change', () => emit({ type: 'drum-change', aircraftId: 1, mountIndex: 1 }));
button('own', 'out of ammo', () => emit({ type: 'out-of-ammo', aircraftId: 1, mountIndex: 0 }));
button('own', 'engine damaged', () => emit({ type: 'engine-damaged', aircraftId: 1 }));
button('own', 'engine dead', () => emit({ type: 'engine-dead', aircraftId: 1 }));
button('own', 'fire started', () => emit({ type: 'fire-started', aircraftId: 1 }));
button('own', 'pilot hit', () => emit({ type: 'pilot-hit', aircraftId: 1, killed: false }));
button('own', 'wing fails', () => emit({ type: 'structural-failure', aircraftId: 1, part: 'leftWing' }));
button('own', 'collision', () => emit({ type: 'collision', aId: 1, bId: 2, position: P() }));

// --- World ------------------------------------------------------------------
const at = (dx: number, dy: number, dz: number) => P().add(new Vector3(dx, dy, dz));
check('world', 'fly-by (Albatros, 60 m/s, 50 m)', 'flyby');
check('world', 'six aircraft circling', 'circlers');
button('world', 'flak 150 m', () => emit({ type: 'flak-burst', position: at(100, 60, -90) }));
button('world', 'flak barrage', () => { for (let i = 0; i < 6; i++) setTimeout(() => emit({ type: 'flak-burst', position: at((Math.random() - 0.5) * 900, (Math.random() - 0.3) * 300, -200 - Math.random() * 700) }), i * 400); });
button('world', 'explosion 400 m', () => emit({ type: 'explosion', position: at(-300, -250, -200), size: 2 }));
button('world', 'balloon flames 600 m', () => emit({ type: 'balloon-destroyed', balloonId: 50, killerId: 1, position: at(400, -200, -400) }));
button('world', 'crash 300 m', () => emit({ type: 'aircraft-destroyed', victimId: 99 + Math.floor(Math.random() * 1e6), killerId: 1, outcome: 'crashed', position: at(200, -1440, -200) }));
button('world', 'enemy bursts at 300 m', () => {
  for (let i = 0; i < 20; i++) setTimeout(() => emit({ type: 'gun-fired', shooterId: 2, gun: 'spandau', position: at(200, 50, -200) }), i * 130);
});
button('world', 'near misses', () => spawnBullets(8));
button('world', 'offline self-test', async () => {
  status.textContent = 'rendering…';
  const r = await runSelfTest();
  status.textContent = JSON.stringify(r);
  console.log(r);
});

// --- Near-miss bullets --------------------------------------------------------
interface FakeBullet extends BulletView { position: Vector3; velocity: Vector3; age: number }
const bullets: FakeBullet[] = [];
function spawnBullets(n: number): void {
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const offset = new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, 0);
      bullets.push({ position: at(offset.x, offset.y, -300), velocity: new Vector3(0, 0, 800), tracer: true, side: 'central', age: 0 });
    }, i * 90);
  }
}

// --- Frame loop -------------------------------------------------------------
let last = performance.now();
let t = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += dt;
  world.time = t;

  const s = player.state;
  s.engineRpm = params.dead ? Math.max(0, s.engineRpm - dt * 600) : params.rpm;
  s.airspeed = params.airspeed;
  s.velocity.set(0, params.vy, -Math.sqrt(Math.max(0, params.airspeed ** 2 - params.vy ** 2)));
  s.stalled = params.stalled;
  s.aoa = params.stalled ? 0.35 : 0.05;
  s.onGround = params.onGround;
  s.heightAboveGround = params.onGround ? 0 : 1450;
  player.controls.throttle = params.throttle;
  player.controls.blip = params.blip;
  player.damage.zones.engine = params.damage;
  player.damage.engineDead = params.dead;
  player.damage.onFire = params.fire;

  // Camera: cockpit at the aircraft, or a chase position 25 m behind.
  camera.position.copy(s.position).add(params.cockpit ? new Vector3(0, 0.8, 0) : new Vector3(6, 4, 25));
  camera.lookAt(s.position.x, s.position.y, s.position.z - 100);
  camera.updateMatrixWorld();

  // Fly-by: back-and-forth pass 50 m ahead.
  const span = 3000;
  const x = ((t * 60) % (span * 2)) - span;
  const dir = Math.floor((t * 60) / (span * 2)) % 2 === 0 ? 1 : -1;
  flyby.state.position.set(params.flyby ? x * dir : 1e6, 1520, -50);
  flyby.state.velocity.set(60 * dir, 0, 0);
  flyby.state.engineRpm = params.flyby ? 1450 : 0;

  circlers.forEach((c, i) => {
    const a = t * 0.1 + (i * Math.PI) / 3;
    const r = 500 + i * 120;
    c.state.position.set(Math.cos(a) * r, 1500 + i * 60, Math.sin(a) * r);
    c.state.velocity.set(-Math.sin(a) * r * 0.1, 0, Math.cos(a) * r * 0.1);
    c.state.engineRpm = params.circlers ? 1300 + i * 40 : 0;
  });

  for (const b of bullets) {
    b.position.addScaledVector(b.velocity, dt);
    b.age += dt;
  }
  while (bullets.length && bullets[0].age > 1.5) bullets.shift();

  audio.updateFlight(camera, player, world, dt, params.cockpit);
  audio.updateBullets(bullets);

  const buf = new Float32Array(tap.fftSize);
  tap.getFloatTimeDomainData(buf);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  meter.style.width = `${Math.min(100, peak * 100)}%`;
  if (!status.textContent?.startsWith('{')) status.textContent = `${audio.context.state} · music: ${audio.currentMusic} · peak ${peak.toFixed(2)}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for Playwright QA.
Object.assign(window, { __bench: { audio, tap, params, emit, spawnBullets }, __audioSelfTest: runSelfTest });
