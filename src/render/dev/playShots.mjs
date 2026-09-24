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
  big: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dvii', enemyCount: 8, wingmen: 3, enemySkill: 'veteran', wingmanSkill: 'veteran', altitudeM: 1500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.45, type: 'dogfight', date: '1918-08-08' },
    shots: [10, 30, 50, 70],
    cams: ['fight-wide', 'chase'],
    perf: true,
  },
};

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });

for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => !!window.__rb2?.services);
  await page.evaluate((opts) => {
    const s = window.__rb2.services;
    const settings = structuredClone(s.getSettings());
    settings.realism.invulnerable = true;
    settings.graphics = new URLSearchParams(location.search).get('q') ?? settings.graphics;
    const mission = s.campaign.buildQuickMission(opts);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    s.launcher.fly(mission, settings, host);
  }, sc.opts);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
  // Spectator camera library, installed in the page.
  await page.evaluate(() => {
    const T = window.__rb2render;
    const V = (x, y, z) => ({ x, y, z });
    window.__cam = { mode: 'none', seed: 1 };
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
          const a = player ?? live[0];
          const d = b.position.clone().sub(a.state.position).setY(0).normalize();
          place(b.position.clone().addScaledVector(d, -180).add(new P(0, 40, 0)), b.position);
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
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${outDir}/${name}-t${String(t).padStart(3, '0')}-${cam}.png` });
    }
    const info = await page.evaluate(() => {
      const s = window.__rb2render.stats();
      const w = window.__rb2.session.world;
      return { fps: Math.round(s.fps), ms: s.frameMs.toFixed(1), calls: s.drawCalls, tris: s.triangles, parts: s.particles, cpu: s.cpu, alive: w.aircraft.filter((a) => !a.outcome).length, smoking: w.aircraft.filter((a) => a.damage.smoking).length, burning: w.balloons?.filter((b) => b.burning).length };
    });
    console.log(name, 't=' + t, JSON.stringify(info));
  }
  if (errors.length) console.log(name, 'ERRORS', errors.slice(0, 5));
  await page.close();
}
await browser.close();
