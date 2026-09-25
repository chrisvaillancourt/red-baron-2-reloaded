// Production-build check. Serve dist/ (e.g. `pnpm preview --port 5325 --strictPort`),
// then: node tools/playtest/prodcheck.mjs 5325 [subpath]
// Loads the menus, flies a quick mission, and reports every failed request,
// console error, worker started, and GLB/art/chunk fetched. Exits 1 on failure.
import { chromium } from '@playwright/test';

const port = process.argv[2] ?? '5325';
const sub = process.argv[3] ?? '/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const failed = [];
const errors = [];
const fetched = new Set();
page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText})`));
page.on('response', (r) => {
  const u = new URL(r.url());
  const type = r.headers()['content-type'] ?? '';
  if (r.status() >= 400) failed.push(`${u.pathname} -> ${r.status()}`);
  // SPA-style servers answer unknown paths with index.html: an asset that comes back as HTML is missing.
  else if (/\.(jpe?g|png|glb|js|css|wasm)$/.test(u.pathname) && type.includes('text/html')) failed.push(`${u.pathname} -> served as HTML (missing asset)`);
  else fetched.add(u.pathname);
});
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const workers = [];
page.on('worker', (w) => workers.push(new URL(w.url()).pathname));

const t0 = Date.now();
await page.goto(`http://localhost:${port}${sub}`);
await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30000 });
const menuMs = Date.now() - t0;
await page.waitForTimeout(2500); // idle prefetch of the flight chunk
const prefetched = [...fetched].some((p) => p.includes('flightModules'));
await page.screenshot({ path: 'test-results/prod-menu.png' });
await page.evaluate(() => {
  const s = window.__rb2.services;
  const m = s.campaign.buildQuickMission({
    playerAircraft: 'bristol_f2b', enemyAircraft: 'albatros_dv', enemyCount: 2, wingmen: 1,
    enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1200, startPosition: 'head-on',
    timeOfDay: 'afternoon', cloudCover: 0.4, type: 'balloon-attack',
  });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.appendChild(host);
  window.__done = null;
  s.launcher.fly(m, s.getSettings(), host).then((r) => (window.__done = r), (e) => (window.__done = { error: String(e) }));
});
await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 30, undefined, { timeout: 60000 });
const px = await page.evaluate(() => window.__rb2.session.samplePixels());
await page.screenshot({ path: 'test-results/prod-flight.png' });
await page.evaluate(() => window.__rb2.session.abandon());
await page.waitForFunction(() => window.__done, undefined, { timeout: 20000 });
const result = await page.evaluate(() => window.__done);
await browser.close();

const glbs = [...fetched].filter((p) => p.endsWith('.glb'));
const art = [...fetched].filter((p) => p.includes('/art/'));
const report = { menuMs, prefetched, workers: [...new Set(workers)], glbs, art, pixels: px, failed, errors, resultError: result?.error };
console.log(JSON.stringify(report, null, 2));
const ok = failed.length === 0 && errors.length === 0 && !result?.error && glbs.length > 0 && workers.length >= 3 && px.nonBlack > px.total * 0.5;
console.log(ok ? 'PROD CHECK OK' : 'PROD CHECK FAILED');
process.exit(ok ? 0 : 1);
