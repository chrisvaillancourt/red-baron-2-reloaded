// Screenshot the world harness from several viewpoints.
// Usage: node src/render/dev/shootWorld.mjs <outDir> [port] [shotName...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const port = process.argv[3] ?? '5301';
const only = process.argv.slice(4);
mkdirSync(out, { recursive: true });

const SHOTS = [
  { name: 'arras-800', q: 'town=Arras&alt=800&pitch=-14&date=1917-06-01&tod=morning&cover=0.35' },
  { name: 'ypres-1917-400', q: 'town=Ypres&alt=400&pitch=-18&yaw=60&date=1917-10-20&tod=afternoon&cover=0.5&back=4000' },
  { name: 'somme-albert-150', q: 'town=Pozi%C3%A8res&alt=150&pitch=-10&yaw=200&date=1916-10-01&tod=midday&cover=0.3&back=1500' },
  { name: 'aero-top', q: 'town=Vert%20Galand&alt=250&pitch=-35&date=1917-06-01&tod=morning&cover=0.3&back=450' },
  { name: 'aerodrome-60', q: 'town=Vert%20Galand&alt=60&pitch=-8&date=1917-06-01&tod=morning&cover=0.3&back=700' },
  { name: 'clouds-3300', q: 'town=Cambrai&alt=3300&pitch=-10&yaw=250&date=1917-08-01&tod=afternoon&cover=0.55&base=1600&back=0' },
  { name: 'under-clouds-700', q: 'town=Amiens&alt=700&pitch=8&yaw=120&date=1918-04-20&tod=midday&cover=0.6&base=1300&back=2000' },
  { name: 'dusk-1500', q: 'town=Douai&alt=1500&pitch=-4&yaw=270&date=1917-09-10&tod=dusk&cover=0.35&back=3000' },
  { name: 'objects-close', q: 'town=Bapaume&alt=40&pitch=-6&date=1917-05-01&tod=morning&cover=0.3&demo=1&ds=0.28&back=2500' },
  { name: 'balloons-close', q: 'town=Bapaume&alt=140&pitch=4&date=1917-05-01&tod=afternoon&cover=0.3&demo=1&ds=0.35&back=2500' },
  { name: 'arras-town', q: 'town=Arras&alt=350&pitch=-14&date=1916-03-01&tod=morning&cover=0.3&back=1800' },
  { name: 'arras-close', q: 'town=Arras&alt=120&pitch=-12&date=1916-03-01&tod=morning&cover=0.3&back=500' },
  { name: 'ypres-ruins', q: 'town=Ypres&alt=250&pitch=-16&date=1917-08-01&tod=midday&cover=0.3&back=1400' },
  { name: 'dawn-800', q: 'town=Amiens&alt=800&pitch=-4&yaw=80&date=1917-07-01&tod=dawn&cover=0.35&back=0' },
  { name: 'overcast-500', q: 'town=Lille&alt=500&pitch=-8&date=1917-10-10&tod=afternoon&cover=0.9&base=900&vis=12000&back=3000' },
  { name: 'winter-600', q: 'town=Albert&alt=600&pitch=-10&date=1917-01-15&tod=midday&cover=0.5&back=2500' },
  { name: 'fx-close', q: 'town=Bapaume&alt=300&pitch=0&date=1917-05-01&tod=afternoon&cover=0.3&demo=1&ds=0.3&back=2500' },
  { name: 'flak-central', q: 'town=Cambrai&alt=1500&pitch=4&date=1917-06-01&tod=afternoon&cover=0.3&fx=flak&back=2000' },
  { name: 'flak-allied', q: 'town=Doullens&alt=1500&pitch=4&date=1917-06-01&tod=morning&cover=0.3&base=2600&fx=flak&back=2000' },
  { name: 'boom', q: 'town=Bapaume&alt=80&pitch=-2&date=1917-05-01&tod=afternoon&cover=0.3&fx=boom&back=2500' },
  { name: 'demo-fx', q: 'town=Bapaume&alt=250&pitch=-8&date=1917-05-01&tod=morning&cover=0.3&demo=1&back=2500' },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300));
});
page.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const s of SHOTS) {
  if (only.length && !only.includes(s.name)) continue;
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/dev/world.html?${process.env.EXTRA ?? ''}${s.q}`);
  await page.waitForFunction(() => window.__harness, null, { timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => window.__harness.stats());
    if (process.env.VERBOSE) console.log("  t", i, JSON.stringify(st));
    if (i >= 6 && st.terrainPending === 0) break;
    await page.waitForTimeout(1000);
  }
  const stats = await page.evaluate(() => window.__harness.stats());
  await page.evaluate(() => document.getElementById('panel').classList.add('hidden'));
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log(s.name, `${Date.now() - t0}ms`, JSON.stringify(stats));
}
await browser.close();
