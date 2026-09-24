// Headless QA for the audio bench. Usage:
//   pnpm exec vite --port 5291 &   then   node src/audio/dev/qa.mjs [http://localhost:5291]
// Clicks through every bench control, runs the offline self-test, and fails on
// console errors, NaNs, silence or clipping.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5291';
// Prefer installed Google Chrome (the Playwright-pinned Chromium build may not be downloaded).
const launchArgs = { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch({ ...launchArgs, channel: 'chrome' }).catch(() => chromium.launch(launchArgs));
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}/dev/audio.html`);
await page.click('#start');
await page.waitForTimeout(500);

// Live engine: exercise everything and sample the master tap.
const live = await page.evaluate(async () => {
  const { audio, tap, params, emit, spawnBullets } = window.__bench;
  const peaks = {};
  const sample = async (label, ms = 600) => {
    let peak = 0;
    const buf = new Float32Array(tap.fftSize);
    const end = performance.now() + ms;
    while (performance.now() < end) {
      tap.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Number.isFinite(v) ? Math.abs(v) : 99);
      await new Promise((r) => setTimeout(r, 30));
    }
    peaks[label] = Math.round(peak * 1000) / 1000;
  };
  await sample('engine+wind', 800);
  params.flyby = true; params.circlers = true; await sample('fly-by+circlers', 800);
  params.blip = true; await sample('blip', 400); params.blip = false;
  params.cockpit = false; await sample('chase view', 500); params.cockpit = true;
  params.damage = 0.9; params.stalled = true; params.fire = true; params.vy = -40; params.airspeed = 90;
  await sample('damaged+stall+fire+dive', 800);
  params.damage = 0; params.stalled = false; params.fire = false; params.vy = 0; params.airspeed = 50;
  for (const b of document.querySelectorAll('#own button, #world button, #ui button')) {
    if (b.textContent.includes('self-test')) continue;
    b.click();
    await new Promise((r) => setTimeout(r, 120));
  }
  spawnBullets(6);
  await sample('events', 1500);
  const gunButtons = [...document.querySelectorAll('#guns button')];
  for (const b of gunButtons) b.dispatchEvent(new PointerEvent('pointerdown'));
  await sample('own guns', 500);
  for (const b of gunButtons) b.dispatchEvent(new PointerEvent('pointerup'));
  params.enemyGuns = true;
  gunButtons[1].dispatchEvent(new PointerEvent('pointerdown'));
  await sample('enemy guns', 500);
  gunButtons[1].dispatchEvent(new PointerEvent('pointerup'));
  const cues = {};
  for (const cue of ['menu', 'briefing', 'defeat', 'victory', 'medal']) {
    audio.playMusic(cue);
    await new Promise((r) => setTimeout(r, 1500));
    cues[cue] = audio.currentMusic;
  }
  audio.playMusic('flight');
  params.dead = true;
  audio.stopFlight();
  return { peaks, cues, state: audio.context.state };
});

const offline = await page.evaluate(() => window.__audioSelfTest());
await browser.close();

console.log(JSON.stringify({ live, offline, errors }, null, 2));
const bad = [];
if (errors.length) bad.push(`console errors: ${errors.length}`);
for (const r of offline) {
  if (r.nans > 0) bad.push(`${r.name}: NaNs`);
  if (r.rms < 0.005) bad.push(`${r.name}: silent (rms ${r.rms})`);
  if (r.peak > 1.0) bad.push(`${r.name}: clipping (peak ${r.peak})`);
}
for (const [k, v] of Object.entries(live.peaks)) {
  if (v >= 99) bad.push(`live ${k}: NaN`);
  if (v < 0.005) bad.push(`live ${k}: silent`);
}
if (bad.length) {
  console.error('QA FAILED:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('QA OK');
