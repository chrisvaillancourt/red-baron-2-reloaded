// Front-line look QA: park a spectator camera over the trench line at fixed
// altitudes (oblique 300 / 1000 / 2500 m and a steep look-down from 2000 m)
// and screenshot it. Used to judge trenches, no-man's-land and woods at the
// distances players actually see them from.
//
//   node src/render/dev/frontShots.mjs <outDir> [port] [site ...]
//
// Sites: croisilles (Feb 1918, winter), somme (Sep 1916), ypres (Oct 1917, Flanders).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'front-shots';
const port = Number(process.argv[3] ?? 5332);
const only = process.argv.slice(4);
mkdirSync(outDir, { recursive: true });

const SITES = {
  croisilles: { lat: 50.2, lon: 2.88, date: '1918-02-20', timeOfDay: 'midday', aircraft: ['sopwith_camel', 'albatros_dv'] },
  somme: { lat: 50.04, lon: 2.73, date: '1916-09-15', timeOfDay: 'morning', aircraft: ['nieuport_17', 'albatros_dii'] },
  ypres: { lat: 50.87, lon: 2.95, date: '1917-10-12', timeOfDay: 'afternoon', aircraft: ['sopwith_camel', 'albatros_dv'] },
};
// [name, altitude m, horizontal stand-off as a multiple of altitude (0 = straight down)]
const VIEWS = [['a0300', 300, 2.2], ['a1000', 1000, 1.9], ['a2500', 2500, 1.6], ['down2000', 2000, 0]];

// UNCAPPED=1 lifts vsync so the per-view frame-interval p50 measures GPU cost.
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });

for (const [name, site] of Object.entries(SITES)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/${process.env.Q ? '?q=' + process.env.Q : ''}`);
  await page.waitForFunction(() => !!window.__rb2?.services);
  await page.evaluate((site) => {
    const s = window.__rb2.services;
    const settings = structuredClone(s.getSettings());
    settings.realism.invulnerable = true;
    settings.graphics = new URLSearchParams(location.search).get('q') ?? settings.graphics;
    const mission = s.campaign.buildQuickMission({
      playerAircraft: site.aircraft[0], enemyAircraft: site.aircraft[1], enemyCount: 1, wingmen: 0,
      enemySkill: 'novice', wingmanSkill: 'regular', altitudeM: 1500, startPosition: 'head-on',
      timeOfDay: site.timeOfDay, cloudCover: 0.1, type: 'dogfight', date: site.date,
    });
    // Aircraft well away from the site so nothing crosses the frame.
    for (const f of mission.flights) { f.start.x = f.role === 'enemy' ? 60000 : -60000; f.start.z = -60000; }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    s.launcher.fly(mission, settings, host);
  }, site);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
  const front = await page.evaluate((site) => {
    window.__rb2.session.command('toggleHud');
    const w = window.__rb2.session.world;
    const z = -(site.lat - 50.3) * 111200;
    const x0 = (site.lon - 2.8) * 111200 * Math.cos((50.3 * Math.PI) / 180);
    let prev = w.sideOfFrontAt(x0 - 15000, z);
    for (let x = x0 - 15000; x < x0 + 15000; x += 25) {
      const s = w.sideOfFrontAt(x, z);
      if (s !== prev) return { x, z };
      prev = s;
    }
    return { x: x0, z };
  }, site);
  const perf = {};
  for (const [view, alt, k] of VIEWS) {
    await page.evaluate(([f, alt, k]) => {
      const w = window.__rb2.session.world;
      const g = w.groundHeightAt(f.x, f.z);
      window.__rb2render.debugCameraHook = (cam) => {
        const P = cam.position.constructor;
        if (k === 0) {
          cam.position.set(f.x, g + alt, f.z);
          cam.up.set(0, 0, -1);
          cam.lookAt(new P(f.x, g, f.z + 1e-3));
        } else {
          // Looking north-east across the line from the south-west.
          cam.position.set(f.x - alt * k * 0.8, g + alt, f.z + alt * k * 0.6);
          cam.up.set(0, 1, 0);
          cam.lookAt(new P(f.x, g, f.z));
        }
      };
    }, [front, alt, k]);
    // Let terrain, trees and crater grids stream in around the new camera.
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__rb2render.whenReady?.());
    await page.waitForTimeout(1500);
    if (!process.env.NOSHOT) await page.screenshot({ path: `${outDir}/${name}-${view}.png` });
    // Frame-interval p50 over 2 s with the camera parked.
    const p50 = await page.evaluate(() => new Promise((res) => {
      const f = []; let last = performance.now(); const t0 = last;
      const tick = (t) => { f.push(t - last); last = t; if (t - t0 < 2000) requestAnimationFrame(tick); else { f.sort((a, b) => a - b); res(f[Math.floor(f.length / 2)].toFixed(2)); } };
      requestAnimationFrame(tick);
    }));
    perf[view] = p50;
  }
  console.log(name, JSON.stringify(front), 'p50 ms', JSON.stringify(perf));
  if (errors.length) console.log(name, 'ERRORS', errors.slice(0, 5));
  await page.close();
}
await browser.close();
