// Ad-hoc probe: load the harness and evaluate an expression.
// Usage: node src/render/dev/probe.mjs "<query string>" "<js expression using h = window.__harness>"
import { chromium } from '@playwright/test';

const [q, expr] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300));
});
await page.goto(`http://localhost:${process.env.PORT ?? 5301}/dev/world.html?${q}`);
await page.waitForFunction(() => window.__harness, null, { timeout: 30000 });
await page.waitForTimeout(Number(process.env.WAIT ?? 6000));
const r = await page.evaluate(`(() => { const h = window.__harness; return ${expr}; })()`);
console.log(JSON.stringify(r, null, 1));
if (process.env.SHOT) { await page.waitForTimeout(500); await page.screenshot({ path: process.env.SHOT }); }
await browser.close();
