// Screenshot every UI screen from the harness (dev/ui.html).
// Usage: node dev/screenshot-ui.mjs [baseUrl] [outDir] [width] [height] [filter]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5291';
const out = process.argv[3] ?? 'docs/screenshots';
const width = Number(process.argv[4] ?? 1600);
const height = Number(process.argv[5] ?? 900);
const filter = process.argv[6];
mkdirSync(out, { recursive: true });

const shots = [
  ['title', 'screen=title'],
  ['roster', 'screen=roster'],
  ['create-pilot', 'screen=create-pilot'],
  ['hq-orders', 'screen=hq'],
  ['hq-logbook', 'screen=hq&tab=1'],
  ['hq-victories', 'screen=hq&tab=2'],
  ['hq-medals', 'screen=hq&tab=3'],
  ['hq-aces', 'screen=hq&tab=4'],
  ['hq-squadron', 'screen=hq&tab=5'],
  ['briefing', 'screen=briefing'],
  ['debrief-report', 'screen=debrief'],
  ['debrief-newspaper', 'screen=debrief', 1],
  ['debrief-promotion', 'screen=debrief', 2],
  ['debrief-medal', 'screen=debrief', 3],
  ['debrief-telegram', 'screen=debrief&fate=killed'],
  ['debrief-memorial', 'screen=debrief&fate=killed', 5],
  ['quick', 'screen=quick'],
  ['options-realism', 'screen=options'],
  ['options-keys', 'screen=options&tab=4'],
  ['controls', 'screen=controls'],
  ['credits', 'screen=credits'],
  ['aces', 'screen=aces'],
  ['hud', 'screen=hud'],
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
// Missing Blender art (public/art/*.jpg) 404s by design until the art lands.
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${page.url()}: ${m.text()}`));
for (const [name, query, advance] of shots) {
  if (filter && !name.includes(filter)) continue;
  await page.goto(`${base}/dev/ui.html?${query}`);
  await page.waitForTimeout(900);
  for (let i = 0; i < (advance ?? 0); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  if (advance) await page.waitForTimeout(1000);
  if (name === 'hud') await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/ui-${name}.png` });
  console.log('shot', name);
}
await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
}
