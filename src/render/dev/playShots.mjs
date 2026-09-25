// In-game visual QA: launch real quick missions and screenshot them with
// scripted spectator cameras (via the dev-only __rb2render.debugCameraHook).
//
//   node src/render/dev/playShots.mjs <outDir> [port] [scenario ...]
//
// Scenarios: dogfight, balloon, strafe, dawn, clouds, dusk, overcast, big (16 aircraft perf).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const port = Number(process.argv[3] ?? 5303);
const only = process.argv.slice(4);
mkdirSync(outDir, { recursive: true });

const HIDE_HUD = `__rb2.session.command('toggleHud'); __rb2.session.command('viewChase');`;

const SCENARIOS = {
  dogfight: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 4, wingmen: 3, enemySkill: 'veteran', wingmanSkill: 'veteran', altitudeM: 1800, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35, type: 'dogfight', date: '1917-09-15' },
    shots: [8, 20, 32, 45, 60, 75, 90],
    cams: ['fight', 'fight-wide', 'victim', 'cockpit'],
  },
  balloon: {
    opts: { playerAircraft: 'spad_xiii', enemyAircraft: 'fokker_dvii', enemyCount: 1, wingmen: 2, enemySkill: 'novice', wingmanSkill: 'ace', altitudeM: 900, startPosition: 'advantage', timeOfDay: 'morning', cloudCover: 0.3, type: 'balloon-attack', date: '1918-09-15' },
    shots: [10, 25, 40, 55, 70, 85, 100],
    cams: ['balloon', 'fight-wide', 'chase'],
  },
  strafe: {
    opts: { playerAircraft: 'se5a', enemyAircraft: 'albatros_dv', enemyCount: 1, wingmen: 2, enemySkill: 'novice', wingmanSkill: 'ace', altitudeM: 300, startPosition: 'advantage', timeOfDay: 'midday', cloudCover: 0.2, type: 'ground-attack', date: '1917-11-22' },
    shots: [8, 20, 35, 50, 65, 80],
    cams: ['ground', 'chase', 'low'],
  },
  dawn: {
    opts: { playerAircraft: 'fokker_dri', enemyAircraft: 'sopwith_camel', enemyCount: 3, wingmen: 3, enemySkill: 'regular', wingmanSkill: 'veteran', altitudeM: 1500, startPosition: 'advantage', timeOfDay: 'dawn', cloudCover: 0.3, type: 'dogfight', date: '1918-03-24' },
    shots: [6, 25, 45],
    cams: ['formation', 'fight', 'cockpit'],
  },
  clouds: {
    opts: { playerAircraft: 'albatros_diii', enemyAircraft: 'sopwith_pup', enemyCount: 2, wingmen: 2, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2800, startPosition: 'head-on', timeOfDay: 'midday', cloudCover: 0.6, type: 'dogfight', date: '1917-04-20' },
    shots: [6, 20, 40],
    cams: ['formation', 'fight-wide', 'cockpit'],
  },
  dusk: {
    opts: { playerAircraft: 'fokker_dvii', enemyAircraft: 'se5a', enemyCount: 3, wingmen: 2, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1200, startPosition: 'head-on', timeOfDay: 'dusk', cloudCover: 0.4, type: 'dogfight', date: '1918-07-10' },
    shots: [6, 25, 45],
    cams: ['formation', 'fight', 'cockpit'],
  },
  overcast: {
    opts: { playerAircraft: 'nieuport_17', enemyAircraft: 'albatros_dii', enemyCount: 2, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 900, startPosition: 'head-on', timeOfDay: 'morning', cloudCover: 0.9, type: 'dogfight', date: '1916-12-20' },
    shots: [6, 25],
    cams: ['formation', 'fight-wide'],
  },
  // Forced damage: set enemies smoking / on fire and flame a balloon to judge effects.
  fx: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 3, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1200, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.3, type: 'dogfight', date: '1917-06-10' },
    actions: [
      { t: 4, code: `const w = __rb2.session.world, p = __rb2.session.player; const en = w.aircraft.filter(a => a.side !== p.side); en[0].damage.onFire = true; en[0].damage.lastAttackerId = p.id; en[1].damage.smoking = true; en[1].damage.zones.engine = 0.7;` },
    ],
    shots: [6, 9, 13, 18, 26, 40],
    cams: ['victim', 'fight-wide'],
  },
  balloonfx: {
    opts: { playerAircraft: 'spad_xiii', enemyAircraft: 'fokker_dvii', enemyCount: 1, wingmen: 0, enemySkill: 'novice', wingmanSkill: 'ace', altitudeM: 900, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.3, type: 'balloon-attack', date: '1918-09-15' },
    actions: [
      { t: 3, code: `const b = __rb2.session.world.balloons[0]; b.observerBailed = true;` },
      { t: 5, code: `const b = __rb2.session.world.balloons[0]; b.burning = true; b.destroyed = true; b.health = 0; __rb2render.effects.hydrogenFireball(b.position.clone());` },
    ],
    shots: [4, 5.3, 6, 7.5, 10, 14, 20],
    cams: ['balloon'],
  },
  big: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dvii', enemyCount: 8, wingmen: 3, enemySkill: 'veteran', wingmanSkill: 'veteran', altitudeM: 1500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.45, type: 'dogfight', date: '1918-08-08' },
    shots: [10, 30, 50, 70],
    cams: ['fight-wide', 'chase'],
    perf: true,
  },
  // ---- Showcase set (docs/screenshots/game-*.png): HUD hidden, art-directed cameras.
  'sc-dogfight': {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dri', enemyCount: 3, wingmen: 2, enemySkill: 'ace', wingmanSkill: 'veteran', altitudeM: 1400, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.4, type: 'dogfight', date: '1918-03-28' },
    actions: [{ t: 1, code: HIDE_HUD }],
    shots: [36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90],
    cams: ["closepass"],
  },
  'sc-balloon': {
    opts: { playerAircraft: 'spad_xiii', enemyAircraft: 'fokker_dvii', enemyCount: 1, wingmen: 1, enemySkill: 'novice', wingmanSkill: 'ace', altitudeM: 700, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.35, type: 'balloon-attack', date: '1918-09-15' },
    actions: [
      { t: 1, code: HIDE_HUD },
      { t: 2, code: `window.__cam.balloonDist = 125;` },
      { t: 3, code: `const b = __rb2.session.world.balloons[0]; b.observerBailed = true;` },
      { t: 5, code: `const b = __rb2.session.world.balloons[0]; b.burning = true; b.destroyed = true; b.health = 0; __rb2render.effects.hydrogenFireball(b.position.clone());` },
    ],
    shots: [5.3, 5.6, 6, 6.5, 7.2, 8.5],
    cams: ['balloon'],
  },
  'sc-strafe': {
    opts: { playerAircraft: 'se5a', enemyAircraft: 'albatros_dv', enemyCount: 1, wingmen: 1, enemySkill: 'novice', wingmanSkill: 'veteran', altitudeM: 300, startPosition: 'advantage', timeOfDay: 'morning', cloudCover: 0.3, type: 'ground-attack', date: '1917-11-22' },
    patch: `for (const f of mission.flights) if (f.role === 'player-flight') f.start.altitude = 110;`,
    actions: [{ t: 1, code: HIDE_HUD }],
    shots: [6, 12, 18, 25, 35, 45],
    cams: ['chase-low', 'strafe-side'],
  },
  // Low pass east over the Somme front near Pozières, September 1916.
  'sc-trench': {
    opts: { playerAircraft: 'nieuport_17', enemyAircraft: 'albatros_dii', enemyCount: 1, wingmen: 1, enemySkill: 'novice', wingmanSkill: 'veteran', altitudeM: 300, startPosition: 'head-on', timeOfDay: 'morning', cloudCover: 0.35, type: 'dogfight', date: '1916-09-15' },
    patch: `for (const f of mission.flights) { if (f.role === 'player-flight') { f.start.x = -1500; f.start.z = 30146; f.start.altitude = 205; f.start.heading = Math.PI / 2; } else { f.start.x = 40000; f.start.z = -40000; } }`,
    actions: [{ t: 1, code: HIDE_HUD }, { t: 1.2, code: `const p = __rb2.session.player; p.controls.throttle = 0.8;` }],
    shots: [3, 5, 7, 9, 11, 14],
    cams: ['chase-low', 'strafe-side'],
  },
  'sc-dawn': {
    opts: { playerAircraft: 'fokker_dri', enemyAircraft: 'sopwith_camel', enemyCount: 3, wingmen: 3, enemySkill: 'regular', wingmanSkill: 'veteran', altitudeM: 1500, startPosition: 'advantage', timeOfDay: 'dawn', cloudCover: 0.3, type: 'dogfight', date: '1918-03-24' },
    actions: [{ t: 1, code: HIDE_HUD }],
    shots: [4, 8, 12],
    cams: ['sunward', 'vic'],
  },
  'sc-clouds': {
    opts: { playerAircraft: 'albatros_dv', enemyAircraft: 'se5a', enemyCount: 2, wingmen: 2, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2700, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.6, type: 'dogfight', date: '1917-08-20' },
    patch: `mission.weather.cloudBaseM = 1500; mission.weather.cloudTopM = 2100;`,
    actions: [{ t: 1, code: HIDE_HUD }],
    shots: [4, 8, 14],
    cams: ['vic', 'formation'],
  },
  'sc-burning': {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 3, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1300, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.35, type: 'dogfight', date: '1917-06-10' },
    actions: [
      { t: 1, code: HIDE_HUD },
      { t: 4, code: `const w = __rb2.session.world, p = __rb2.session.player; const en = w.aircraft.filter(a => a.side !== p.side); en[0].damage.onFire = true; en[0].damage.lastAttackerId = p.id; en[0].damage.zones.engine = 1; en[0].damage.engineDead = true;` },
    ],
    shots: [9, 13, 17, 22],
    cams: ['victim', 'victim-close'],
  },
  'sc-aero': {
    opts: { playerAircraft: 'se5a', enemyAircraft: 'albatros_dv', enemyCount: 1, wingmen: 3, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1500, startPosition: 'head-on', timeOfDay: 'dusk', cloudCover: 0.4, type: 'dogfight', date: '1917-09-10' },
    // Park the flight on Vert Galand's strip (x,z from latLonToWorld(50.13, 2.33)); enemies far off.
    patch: `for (const f of mission.flights) { if (f.role === 'player-flight') { f.startOnGround = true; f.start.x = -33413; f.start.z = 18904; f.start.altitude = 0; f.start.heading = 250 * Math.PI / 180; f.start.airspeed = 0; } else { f.start.x = 30000; f.start.z = -30000; } }`,
    actions: [{ t: 1, code: HIDE_HUD }],
    shots: [3, 5],
    cams: ['aero', 'aero-wide'],
  },
  // 16 aircraft (4 + 12): quick missions cap at 12, so pad the flights. Perf budget scenario.
  big16: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dvii', enemyCount: 8, wingmen: 3, enemySkill: 'veteran', wingmanSkill: 'veteran', altitudeM: 1500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.45, type: 'dogfight', date: '1918-08-08' },
    patch: `for (const f of mission.flights) { const extra = f.role === 'enemy' ? 2 : (f.role === 'player-flight' ? 2 : 0); for (let i = 0; i < extra; i++) f.members.push({ ...f.members[f.members.length - 1], isPlayer: false, pilotName: undefined }); }`,
    shots: [15, 30, 45, 60, 75],
    cams: ['fight-wide'],
    perf: true,
  },
};

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });

for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/${process.env.Q ? '?q=' + process.env.Q : ''}`);
  await page.waitForFunction(() => !!window.__rb2?.services);
  await page.evaluate(([opts, patch]) => {
    const s = window.__rb2.services;
    const settings = structuredClone(s.getSettings());
    settings.realism.invulnerable = true;
    settings.graphics = new URLSearchParams(location.search).get('q') ?? settings.graphics;
    const mission = s.campaign.buildQuickMission(opts);
    if (patch) new Function('mission', patch)(mission);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    s.launcher.fly(mission, settings, host);
  }, [sc.opts, sc.patch ?? null]);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
  // Spectator camera library, installed in the page.
  await page.evaluate(() => {
    const T = window.__rb2render;
    const V = (x, y, z) => ({ x, y, z });
    window.__cam = { mode: 'none', seed: 1 };
    // Frame-interval log for hitch analysis.
    window.__frames = [];
    let last = performance.now();
    window.__hitchLog = [];
    const tick = (t) => { const d = t - last; window.__frames.push(d); if (d > 25) { const R = window.__rb2render; window.__hitchLog.push([+(window.__rb2?.session?.time ?? -1).toFixed(2), Math.round(d), R ? Object.fromEntries(Object.entries(R.lastCpu).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)])) : null, R ? R.renderer.info.programs.length : 0]); } last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    T.debugCameraHook = (cam) => {
      const st = window.__cam;
      if (st.mode === 'none') return;
      const w = window.__rb2.session.world;
      const player = window.__rb2.session.player;
      const live = w.aircraft.filter((a) => !a.outcome);
      const P = cam.position.constructor;
      const dist = (a, b) => a.state.position.distanceTo(b.state.position);
      let subject = null, other = null;
      const enemies = live.filter((a) => player && a.side !== player.side);
      const pairs = [];
      for (const a of live) for (const b of live) if (a.side !== b.side) pairs.push([a, b, dist(a, b)]);
      pairs.sort((p, q) => p[2] - q[2]);
      const place = (from, look) => { cam.position.copy(from); cam.up.set(0, 1, 0); cam.lookAt(look); };
      const off = (a, back, up, side) => {
        const q = a.state.orientation;
        const fwd = new P(0, 0, -1).applyQuaternion(q);
        const right = new P(1, 0, 0).applyQuaternion(q);
        return a.state.position.clone().addScaledVector(fwd, -back).add(new P(0, up, 0)).addScaledVector(right, side);
      };
      switch (st.mode) {
        case 'fight': {
          if (!pairs.length) return;
          const [a, b] = pairs[0];
          const mid = a.state.position.clone().lerp(b.state.position, 0.5);
          place(off(a, 25, 6, 8), mid);
          break;
        }
        case 'fight-wide': {
          if (!pairs.length) return;
          const [a, b] = pairs[0];
          const mid = a.state.position.clone().lerp(b.state.position, 0.5);
          place(mid.clone().add(new P(140, 60, 160)), mid);
          break;
        }
        case 'victim': {
          const dmg = w.aircraft.filter((a) => a.damage.smoking || a.damage.onFire || a.outcome).sort((a, b) => (b.damage.onFire ? 1 : 0) - (a.damage.onFire ? 1 : 0));
          const v = dmg[0] ?? pairs[0]?.[0];
          if (!v) return;
          place(v.state.position.clone().add(new P(60, 25, 70)), v.state.position);
          break;
        }
        case 'closepass': {
          // Beside the hunted aircraft, looking back past it at the pursuer.
          if (!pairs.length) return;
          const [a, b, dd] = pairs[0];
          if (dd > 160) { st.skip = true; return; }
          const behind = (x, y) => { const f = new P(0, 0, -1).applyQuaternion(y.state.orientation); return x.state.position.clone().sub(y.state.position).dot(f) < 0; };
          const [hunter, prey] = behind(a, b) ? [a, b] : [b, a];
          place(off(prey, -10, 3, 13), prey.state.position.clone().lerp(hunter.state.position, 0.4));
          break;
        }
        case 'vic': {
          // Low 3/4 front view of the player's flight.
          const a = player ?? live[0];
          place(off(a, -28, -5, 22), off(a, 20, 0, -8));
          break;
        }
        case 'chase-low': {
          const a = player ?? live[0];
          place(off(a, 22, 5, 6), off(a, -80, -10, 0));
          break;
        }
        case 'strafe-side': {
          const a = player ?? live[0];
          const p = a.state.position;
          const g = w.groundHeightAt(p.x, p.z);
          const c = off(a, -30, 0, 55);
          c.y = Math.max(g + 20, p.y + 14);
          place(c, off(a, -12, -4, 0));
          break;
        }
        case 'victim-close': {
          const v = w.aircraft.filter((a) => a.damage.onFire)[0];
          if (!v) return;
          place(off(v, 30, 12, 22), v.state.position);
          break;
        }
        case 'balloon-far': {
          const b = w.balloons.find((x) => x.burning) ?? w.balloons[0];
          if (!b) return;
          const bp = (T.balloonVisuals.get(b.id)?.position ?? b.position).clone();
          place(b.position.clone().add(new P(-420, -b.position.y + w.groundHeightAt(b.position.x - 420, b.position.z + 260) + 30, 260)), bp);
          break;
        }
        case 'aero': {
          // Across the strip toward the hangar line (150 m right of the centreline), the scout in front.
          const a = player ?? live[0];
          const p = off(a, 14, 0, -26);
          p.y = w.groundHeightAt(p.x, p.z) + 1.8;
          const t = off(a, -8, 0, 150);
          t.y = w.groundHeightAt(t.x, t.z) + 3;
          place(p, t);
          break;
        }
        case 'aero-wide': {
          const a = player ?? live[0];
          const p = off(a, 60, 0, -45);
          p.y = w.groundHeightAt(p.x, p.z) + 9;
          const t = off(a, -10, 0, 120);
          t.y = w.groundHeightAt(t.x, t.z) + 2;
          place(p, t);
          break;
        }
        case 'sunward': {
          // Into the low sun: the flight silhouetted against the glow.
          const a = player ?? live[0];
          const s = T.sunDirection;
          const h = new P(s.x, 0, s.z).normalize();
          const pos = a.state.position.clone().addScaledVector(h, -38).add(new P(0, 4, 0));
          place(pos, a.state.position.clone().addScaledVector(h, 60).add(new P(0, 8, 0)));
          break;
        }
        case 'formation': {
          const a = player ?? live[0];
          place(off(a, -30, 4, 40), a.state.position.clone().add(new P(0, 0, 0)));
          break;
        }
        case 'chase': {
          const a = player ?? live[0];
          place(off(a, 30, 8, 0), off(a, -60, 0, 0));
          break;
        }
        case 'low': {
          const a = player ?? live[0];
          const p = a.state.position.clone();
          const g = w.groundHeightAt(p.x + 60, p.z + 60);
          place(new P(p.x + 60, g + 3, p.z + 60), p);
          break;
        }
        case 'balloon': {
          const b = w.balloons.find((x) => x.burning) ?? w.balloons[0];
          if (!b) return;
          const vis = T.balloonVisuals.get(b.id);
          const bp = vis ? vis.position.clone() : b.position.clone();
          const d = new P(1, 0, 0.6).normalize();
          place(b.position.clone().addScaledVector(d, -st.balloonDist || -220).add(new P(0, 20, 0)), bp);
          break;
        }
        case 'ground': {
          const g = w.groundTargets.find((x) => x.destroyed) ?? w.groundTargets[0];
          if (!g) return;
          place(g.position.clone().add(new P(80, 40, 90)), g.position);
          break;
        }
      }
    };
  });
  const pending = [...(sc.actions ?? [])];
  for (const t of sc.shots) {
    while (pending.length && pending[0].t <= t) {
      const a = pending.shift();
      await page.waitForFunction((t) => (window.__rb2?.session?.time ?? 0) >= t, a.t, { timeout: 180_000 }).catch(() => {});
      await page.evaluate(a.code);
    }
    await page.waitForFunction((t) => (window.__rb2?.session?.time ?? 0) >= t || !window.__rb2?.session, t, { timeout: 180_000 }).catch(() => {});
    if (!(await page.evaluate(() => !!window.__rb2?.session))) break;
    for (const cam of sc.cams) {
      if (cam === 'cockpit') {
        await page.evaluate(() => { window.__cam.mode = 'none'; window.__rb2.session.command('viewCockpit'); });
      } else {
        await page.evaluate((m) => { window.__cam.mode = m; }, cam);
      }
      await page.evaluate(() => { window.__cam.skip = false; });
      await page.waitForTimeout(120);
      if (await page.evaluate(() => window.__cam.skip)) continue;
      if (!process.env.NOSHOT) await page.screenshot({ path: `${outDir}/${name}-t${String(t).padStart(3, '0')}-${cam}.png` });
    }
    const info = await page.evaluate(() => {
      const s = window.__rb2render.stats();
      window.__rb2render.towns.buildMaxMs = 0;
      const w = window.__rb2.session.world;
      const f = window.__frames.splice(0).sort((a, b) => a - b);
      const pct = (q) => f.length ? f[Math.min(f.length - 1, Math.floor(q * f.length))].toFixed(1) : 0;
      return { p50: pct(0.5), p95: pct(0.95), max: pct(1), hitches: f.filter((x) => x > 25).length, n: f.length, fps: Math.round(s.fps), ms: s.frameMs.toFixed(1), calls: s.drawCalls, tris: s.triangles, parts: s.particles, cpu: s.cpu, trees: s.trees, alive: w.aircraft.filter((a) => !a.outcome).length, smoking: w.aircraft.filter((a) => a.damage.smoking).length, burning: w.balloons?.filter((b) => b.burning).length };
    });
    console.log(name, 't=' + t, JSON.stringify(info));
  }
  console.log(name, 'hitches@', JSON.stringify(await page.evaluate(() => window.__hitchLog.slice(0, 30))));
  if (errors.length) console.log(name, 'ERRORS', errors.slice(0, 5));
  await page.close();
}
await browser.close();
