// Headless QA for the audio bench. Usage:
//   pnpm exec vite --port 5291 &   then   node src/audio/dev/qa.mjs [http://localhost:5291]
// Clicks through every bench control, runs the offline self-test, and fails on
// console errors, NaNs, silence or clipping.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { automationLaunchOptions, disableGamepads } from '../../../tools/playtest/browser-automation.mjs';

const base = process.argv[2] ?? 'http://localhost:5291';
const scratch = new URL('../../../tools/dev/scratch/workflowz-ground-audio/', import.meta.url);
await mkdir(scratch, { recursive: true });
const browser = await chromium.launch(automationLaunchOptions(['--autoplay-policy=no-user-gesture-required']));
try {
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await disableGamepads(context);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}/dev/audio.html`);
await page.click('#start');
await page.waitForTimeout(500);
await page.screenshot({ path: fileURLToPath(new URL('bench-flight.png', scratch)), fullPage: true });

// No synthetic whistle or private bus bypass: isolate consumers at the bench query seam,
// then release a real loaded store through handleEvent and the updateFlight queue.
const groundEffects = await page.evaluate(async () => {
  const bench = window.__bench;
  const { audio, tap } = bench;
  const { getAircraft } = await import('/src/data/aircraft.ts');
  const stores = getAircraft('dh4').bombs;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sample = async (ms) => {
    const buf = new Float32Array(tap.fftSize);
    let peak = 0, sum = 0, count = 0, nans = 0, clipped = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      tap.getFloatTimeDomainData(buf);
      for (const value of buf) {
        if (!Number.isFinite(value)) { nans++; continue; }
        peak = Math.max(peak, Math.abs(value));
        sum += value * value; count++;
        if (Math.abs(value) > 1) clipped++;
      }
      await wait(20);
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, count)), nans, clipped };
  };
  const evidence = {};
  audio.playMusic('none');
  bench.setIsolated(true);
  audio.setVolumes(0.8, 0, 0.9);
  try {
    for (const preset of ['flight', 'ground']) {
      bench.setListenerPreset(preset);
      await wait(1600); // Drain previously disposed voices and music fades.
      const baseline = await sample(400);
      const release = bench.releaseBomb(false); // Only omit the later burst, not the whistle.
      const releaseTime = audio.context.currentTime;
      const before = await sample(600);
      // Sample the complete predicted fall + propagation window. A high-altitude
      // ineligible release must remain silent; the ground release must be audible.
      const path = await sample((release.time + release.distance / 343 + 1) * 1000);
      evidence[preset] = { baseline, before, path, release, releaseTime, positions: bench.getPositions(), expectedStoreMassKg: stores?.[release.storeIndex]?.massKg };
      bench.resetBomb();
      await wait(1000);
      evidence[preset].cleanup = await sample(400);
      const cancelled = bench.releaseBomb(false);
      bench.resetBomb();
      evidence[preset].cancelled = await sample((cancelled.time + cancelled.distance / 343 + 1) * 1000);
      const burst = [...document.querySelectorAll('#world button')].find((b) => b.textContent === 'bomb burst 300 m (23 kg)');
      if (!burst) throw new Error('Ground bomb-burst control missing');
      burst.click();
      evidence[preset].burst = await sample(7500);
      await wait(1000);
    }
  } finally {
    bench.resetBomb();
    bench.setIsolated(false);
    bench.setListenerPreset('flight');
    audio.setVolumes(0.8, 0.6, 0.9);
  }
  return evidence;
});
await page.evaluate(() => window.__bench.setListenerPreset('ground'));
await page.waitForTimeout(100);
await page.screenshot({ path: fileURLToPath(new URL('bench-ground.png', scratch)), fullPage: true });
await page.evaluate(() => window.__bench.setListenerPreset('flight'));

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
    if (b.textContent.includes('self-test') || b.textContent.includes('falling bomb')) continue;
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
await page.evaluate(() => { window.__bench.resetBomb(); return window.__bench.audio.close(); });

console.log(JSON.stringify({ groundEffects, live, offline, errors, screenshots: ['bench-flight.png', 'bench-ground.png'] }, null, 2));
const bad = [];
if (errors.length) bad.push(`console errors: ${errors.length}`);
for (const [preset, evidence] of Object.entries(groundEffects)) {
  for (const [label, metric] of Object.entries({ baseline: evidence.baseline, before: evidence.before, path: evidence.path, cleanup: evidence.cleanup, cancelled: evidence.cancelled, burst: evidence.burst })) {
    if (metric.nans) bad.push(`${preset} ${label}: NaNs`);
    if (metric.clipped) bad.push(`${preset} ${label}: clipping (peak ${metric.peak})`);
    if (label !== 'path' && label !== 'burst' && metric.peak > 0.001) bad.push(`${preset} ${label}: whistle isolation/reset not silent`);
  }
  if (evidence.release.carrier !== 'dh4' || evidence.release.massKg !== evidence.expectedStoreMassKg) bad.push(`${preset}: not the authoritative D.H.4 bomb store`);
  if (evidence.positions.player[1] !== 1500 || evidence.positions.carrier[1] !== 1500) bad.push(`${preset}: aircraft altitude changed`);
  if (evidence.positions.bomb !== null) bad.push(`${preset}: bomb did not complete real trajectory`);
}
if (groundEffects.flight.release.distance <= 700 || groundEffects.flight.path.peak > 0.001) bad.push('flight: out-of-range whistle not silent');
if (groundEffects.ground.release.distance >= 700 || groundEffects.ground.path.peak < 0.005) bad.push('ground: eligible whistle silent');
if (groundEffects.ground.burst.peak < 0.005) bad.push('ground: ground-effect burst control silent');
for (const r of offline) {
  if (r.nans > 0) bad.push(`${r.name}: NaNs`);
  if (r.rms < 0.005) bad.push(`${r.name}: silent (rms ${r.rms})`);
  if (r.peak > 1.0) bad.push(`${r.name}: clipping (peak ${r.peak})`);
}
for (const [k, v] of Object.entries(live.peaks)) {
  if (v >= 99) bad.push(`live ${k}: NaN`);
  if (v < 0.005) bad.push(`live ${k}: silent`);
  if (v > 1 && v < 99) bad.push(`live ${k}: clipping`);
}
if (bad.length) {
  console.error('QA FAILED:\n  ' + bad.join('\n  '));
  process.exitCode = 1;
}
else console.log('QA OK');
} finally {
  await browser.close();
}
