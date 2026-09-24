// Screenshot the hangar harness with Playwright.
//   node tools/hangar-shots.mjs <baseUrl> <outDir> '<json list of shots>'
// shot: { name, id, livery, opts, camera: [pos, target], wait }
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5291', out = 'tools/blender/out/shots', json = '[]'] = process.argv.slice(2);
const shots = JSON.parse(json);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/dev/hangar.html`);
await page.waitForFunction(() => window.__hangar && window.__hangar.ready(), null, { timeout: 30000 });
for (const s of shots) {
  await page.evaluate(async (s) => {
    await window.__hangar.show(s.id, s.livery ?? 'Default', s.opts ?? {});
    if (s.camera) window.__hangar.setCamera(s.camera[0], s.camera[1]);
    if (s.breakWing) window.__hangar.breakWing();
    if (s.debug) window.__hangar.debugBackdrop();
  }, s);
  await page.waitForTimeout(s.wait ?? 600);
  await page.screenshot({ path: `${out}/${s.name}.png` });
}
if (errors.length) console.log('CONSOLE:', errors.slice(0, 10).join('\n'));
await browser.close();
