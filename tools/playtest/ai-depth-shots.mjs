// In-engine proof for the AI depth work (docs/ai.md "Wave 8", DECISIONS D-073/D-074):
//   sun   - René Fonck (ace, 'stalker' signature, SPAD XIII) starts on the sun's bearing,
//           450 m above an unaware Albatros D.V flying straight on a November afternoon,
//           and comes down the sun line. Shots look from the victim up the attack line
//           (HUD on, so the sun glare overlay is drawn) and from the side.
//   cloud - a wounded D.V near a cumulus runs for the cloud with an ace Camel after him.
//
//   [SEED=n] node tools/playtest/ai-depth-shots.mjs <outDir> [port] [sun|cloud ...]
// Logs each shot's AI state (debugState), range and the cloud density at the subject.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/ai-depth';
const port = Number(process.argv[3] ?? 5303);
const only = process.argv.slice(4);
mkdirSync(out, { recursive: true });

const SCENES = {
  sun: {
    opts: { playerAircraft: 'albatros_dv', enemyAircraft: 'spad_xiii', enemyAceId: 'fonck', enemyCount: 1, wingmen: 0, enemySkill: 'ace', wingmanSkill: 'regular', altitudeM: 2000, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.15, type: 'dogfight', date: '1917-11-10' },
    // Player crosses the sun line; Fonck sits 2.8 km out on the sun's bearing, 450 m up.
    patch: `
      const sun = window.__sun;
      const p = mission.flights.find((f) => f.role === 'player-flight');
      const e = mission.flights.find((f) => f.role === 'enemy');
      // Crossing the sun line (heading = sun bearing + 90°): the sun is off his left wing.
      const h = Math.atan2(sun[0], -sun[2]) + Math.PI / 2;
      p.start.heading = h;
      e.start.x = p.start.x + sun[0] / Math.hypot(sun[0], sun[2]) * 2800;
      e.start.z = p.start.z + sun[2] / Math.hypot(sun[0], sun[2]) * 2800;
      e.start.altitude = p.start.altitude + 450;
      e.start.heading = h + Math.PI / 2;
      e.waypoints = [{ x: Math.round(p.start.x), z: Math.round(p.start.z), altitude: p.start.altitude, action: 'patrol', duration: 900 }];
      p.waypoints = [];
    `,
    shots: [20, 25, 30, 35, 40, 44, 48, 52, 56, 60],
    cams: ['victim-view', 'into-sun'],
    noHud: ['into-sun'],
  },
  cloud: {
    opts: { playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 1, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'ace', altitudeM: 1800, startPosition: 'advantage', timeOfDay: 'afternoon', cloudCover: 0.55, type: 'dogfight', date: '1917-08-20' },
    patch: `mission.weather.cloudBaseM = 1500; mission.weather.cloudTopM = 2400;`,
    wound: true,
    shots: [8, 11, 14, 16, 18, 20, 23, 27, 32, 38, 44, 50],
    cams: ['escape-far'],
    noHud: ['escape-far'],
  },
};

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const [name, sc] of Object.entries(SCENES)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?q=ultra&seed=${process.env.SEED ?? sc.seed ?? 1}`);
  await page.waitForFunction(() => !!window.__rb2?.services);
  await page.evaluate(async ([opts, patch]) => {
    const s = window.__rb2.services;
    const settings = structuredClone(s.getSettings());
    settings.realism.invulnerable = true;
    settings.graphics = 'ultra';
    const { sunDirectionFor } = await import('/src/world/sun.ts');
    window.__sun = sunDirectionFor(opts.date, opts.timeOfDay).toArray();
    // Seeded (dev server only) so the same stretch of front, and its clouds, comes up each run.
    const { buildQuickMission } = await import('/src/campaign/index.ts');
    const mission = buildQuickMission(opts, Number(new URLSearchParams(location.search).get('seed') ?? 1));
    if (patch) new Function('mission', patch)(mission);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    s.launcher.fly(mission, settings, host);
  }, [sc.opts, sc.patch ?? null]);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
  if (sc.wound) {
    await page.evaluate(() => {
      const w = window.__rb2.session.world, p = window.__rb2.session.player;
      for (const a of w.aircraft) if (a.side !== p.side) { a.damage.pilotWounded = true; a.damage.zones.pilot = 0.6; a.damage.lastAttackerId = p.id; }
    });
  }
  await page.evaluate(() => {
    window.__cam = { mode: 'none' };
    window.__rb2render.debugCameraHook = (cam) => {
      const st = window.__cam;
      if (st.mode === 'none') return;
      const w = window.__rb2.session.world;
      const player = window.__rb2.session.player;
      const P = cam.position.constructor;
      const enemy = w.aircraft.find((a) => a.side !== player.side && !a.outcome);
      if (!enemy) return;
      const place = (from, look) => { cam.position.copy(from); cam.up.set(0, 1, 0); cam.lookAt(look); };
      const ep = enemy.state.position, pp = player.state.position;
      switch (st.mode) {
        case 'victim-view': {
          // Just above and behind the victim's head, looking at the attacker.
          const fwd = new P(0, 0, -1).applyQuaternion(player.state.orientation);
          place(pp.clone().addScaledVector(fwd, -6).add(new P(0, 2.2, 0)), ep);
          break;
        }
        case 'into-sun': {
          // Behind and below the victim on the far side from the sun, looking up the attack
          // line: victim, attacker and the sun in one frame (HUD hidden).
          const sun = w.sunDirection;
          const line = ep.clone().sub(pp);
          const d = Math.min(260, Math.max(60, line.length() * 0.25));
          place(pp.clone().addScaledVector(sun, -d).add(new P(0, -d * 0.1, 0)), pp.clone().addScaledVector(line, 0.5));
          break;
        }
        case 'escape': {
          // Behind the pursuer (the wingman chasing him), looking at the fugitive.
          const chaser = w.aircraft.filter((a) => a.side === player.side && !a.outcome).sort((a, b) => a.state.position.distanceTo(ep) - b.state.position.distanceTo(ep))[0] ?? player;
          const cp = chaser.state.position;
          const back = cp.clone().sub(ep).normalize();
          place(cp.clone().addScaledVector(back, 30).add(new P(0, 8, 0)), ep);
          break;
        }
        case 'escape-far': {
          // Outside the cloud: behind the fugitive on his pursuer's side, at the nearest of
          // 500-900 m that is clear of cloud (fixed once chosen), through a 22° lens, so the
          // cloud swallowing him is in frame.
          const chaser = w.aircraft.filter((a) => a.side === player.side && !a.outcome).sort((a, b) => a.state.position.distanceTo(ep) - b.state.position.distanceTo(ep))[0] ?? player;
          const back = chaser.state.position.clone().sub(ep).setY(0).normalize();
          let pos = null;
          for (const d of [500, 600, 700, 800, 900]) {
            const c = ep.clone().addScaledVector(back, d).add(new P(0, 60, 0));
            if ((w.cloudDensityAt?.(c.x, c.y, c.z) ?? 0) < 0.01) { pos = c; break; }
          }
          st.fixed = st.fixed ?? pos ?? ep.clone().addScaledVector(back, 900).add(new P(0, 60, 0));
          place(st.fixed, ep);
          if (cam.fov !== 22) { cam.fov = 22; cam.updateProjectionMatrix(); }
          break;
        }
        case 'escape-wide': {
          const q = enemy.state.orientation;
          const right = new P(1, 0, 0).applyQuaternion(q);
          place(ep.clone().addScaledVector(right, 260).add(new P(0, 40, 0)), ep);
          break;
        }
      }
    };
  });
  let prev = 0;
  for (const t of sc.shots) {
    await page.waitForFunction((tt) => (window.__rb2?.session?.world?.time ?? 0) >= tt, t, { timeout: 180_000 });
    for (const cam of sc.cams) {
      const hide = (sc.noHud ?? []).includes(cam);
      if (hide) await page.evaluate(() => window.__rb2.session.command('toggleHud'));
      await page.evaluate((m) => (window.__cam.mode = m), cam);
      await page.waitForTimeout(120);
      const info = await page.evaluate(() => {
        const s = window.__rb2.session, w = s.world, p = s.player;
        const e = w.aircraft.find((a) => a.side !== p.side);
        if (!e) return 'no enemy';
        const st = s.aiState?.(e.id) ?? '';
        const r = e.state.position.distanceTo(p.state.position).toFixed(0);
        const dh = (e.state.position.y - p.state.position.y).toFixed(0);
        const sun = w.sunDirection;
        const los = e.state.position.clone().sub(p.state.position).normalize();
        const sunDeg = sun ? ((Math.acos(Math.min(1, los.dot(sun))) * 180) / Math.PI).toFixed(0) : '-';
        const cd = (w.cloudDensityAt?.(e.state.position.x, e.state.position.y, e.state.position.z) ?? 0).toFixed(2);
        return `t=${w.time.toFixed(0)} enemy "${st}" r=${r} dh=${dh} sun=${sunDeg}° cloud=${cd}${e.outcome ? ' ' + e.outcome : ''}`;
      });
      const file = `${out}/${name}-t${String(t).padStart(3, '0')}-${cam}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      if (hide) await page.evaluate(() => window.__rb2.session.command('toggleHud'));
      console.log(`${file}  ${info}`);
    }
    prev = t;
  }
  void prev;
  console.log(name, errors.length ? `errors: ${errors.join(' | ')}` : 'no console errors');
  await page.close();
}
await browser.close();
