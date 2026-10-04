// Two real-UI passes in one owned native browser; not a full raid/balance test.
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { automationLaunchOptions, waitForDefenseReady, withAutomationPage } from './browser-automation.mjs';

const ROOT = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const USAGE = 'pnpm smoke:defense --port <owned strict-port dev server> [--out <workspace directory>]';
let options;
try {
  options = parseArgs({ options: { port: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } }).values;
  if (options.help) { console.log(USAGE); process.exit(0); }
  const port = Number(options.port);
  if (!options.port || !Number.isInteger(port) || port < 1 || port > 65535 || port === 5173) throw new Error('Supply an explicit automation port, not the human port 5173.');
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const out = resolve(ROOT, options.out ?? 'tools/dev/scratch/direct-playwright-smoke');
const insideWorkspace = path => {
  const fromRoot = relative(ROOT, path);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
};
try {
  if (!insideWorkspace(out)) throw new Error('Smoke output must stay inside the owning workspace.');
  // Resolve the nearest existing ancestor before mkdir can follow a link.
  let ancestor = out;
  for (;;) {
    try {
      if (!insideWorkspace(await realpath(ancestor))) throw new Error('Smoke output links must stay inside the owning workspace.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const url = `http://localhost:${Number(options.port)}/`;
const started = performance.now();
const report = { status: 'running', url, launch: automationLaunchOptions(), checkpoint: 'launch', errors: [], passes: [] };
let ownedBrowser;

async function snapshot(page) {
  return page.evaluate(() => {
    const d = window.__rb2Defense;
    if (!d) return null;
    const state = d.state;
    const rect = d.canvas.getBoundingClientRect();
    const camera = d.scene?.camera;
    return {
      options: { ...state.options }, phase: state.phase, raid: state.raid,
      time: state.time, raidTime: state.raidTime, paused: d.paused,
      selected: state.selected, fuze: state.fuzeRange, capture: document.pointerLockElement === d.canvas,
      pose: camera && [camera.rotation.x, camera.rotation.y, camera.rotation.z], fov: camera?.fov,
      counters: { credits: state.credits, score: state.score, kills: state.kills, bombsIntercepted: state.bombsIntercepted, raidsSurvived: state.raidsSurvived },
      upgrades: { ...state.upgrades },
      weapons: Object.fromEntries(Object.entries(state.weapons).map(([id, gun]) => [id, { ammo: gun.ammo, capacity: gun.capacity, reloadLeft: gun.reloadLeft }])),
      target: d.target && { id: d.target.id, health: d.target.health },
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, pads: navigator.getGamepads().length,
      canvas: { css: [rect.width, rect.height], backing: [d.canvas.width, d.canvas.height], aspect: camera?.aspect },
    };
  });
}

try {
  await mkdir(out, { recursive: true });
  await withAutomationPage(async ({ browser, page }) => {
    ownedBrowser = browser;
    report.browserSetupMs = Math.round(performance.now() - started);
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => report.errors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ kind: 'console', message: message.text() }); });
    const checkErrors = () => assert.deepEqual(report.errors, [], 'Browser errors fail the smoke');
    async function raid(label) {
      report.checkpoint = label;
      checkErrors();
      const state = await snapshot(page);
      assert.ok(state, `${label}: no battery`);
      assert.equal(state.phase, 'raid', `${label}: unexpected phase`);
      assert.equal(state.raid, 1, `${label}: unexpected raid`);
      return state;
    }
    async function pause() {
      const state = await raid('pause');
      if (!state.paused) await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__rb2Defense.paused && !document.pointerLockElement);
    }
    async function resume() {
      report.checkpoint = 'trusted capture';
      const button = page.getByRole('button', { name: 'Return to the guns', exact: true });
      const box = await button.boundingBox();
      assert.ok(box, 'Capture gesture needs a visible button');
      await button.click();
      await page.waitForFunction(() => !window.__rb2Defense.paused && document.pointerLockElement === window.__rb2Defense.canvas);
      const state = await raid('captured');
      assert.equal(state.capture, true);
      assert.equal(state.pads, 0);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    async function settledViewport(width, height) {
      await page.waitForFunction(({ width, height }) => {
        const d = window.__rb2Defense;
        const rect = d?.canvas.getBoundingClientRect();
        return innerWidth === width && innerHeight === height && rect?.width === width && rect.height === height && Math.abs(d.scene.camera.aspect - width / height) < 1e-6;
      }, { width, height });
    }
    async function capture(name) {
      const state = await raid(`screenshot ${name}`);
      assert.equal(state.paused, false, 'Gun evidence must be unobscured and running');
      assert.equal(state.dpr, 1);
      assert.deepEqual(state.canvas.css, state.viewport);
      assert.deepEqual(state.canvas.backing, state.viewport);
      const png = await page.screenshot({ path: resolve(out, `${name}.png`), type: 'png', fullPage: false });
      const pixels = [png.readUInt32BE(16), png.readUInt32BE(20)];
      assert.deepEqual(pixels, state.viewport, 'Native PNG must cover the actual viewport');
      return { name, viewport: state.viewport, dpr: state.dpr, canvas: state.canvas, pixels, selected: state.selected, time: state.time };
    }
    async function select(code, weapon) {
      await raid(`select ${weapon}`);
      await page.keyboard.press(code);
      await page.waitForFunction(weapon => window.__rb2Defense.state.selected === weapon, weapon);
    }
    async function keyboardFire(weapon) {
      const before = await raid(`keyboard fire ${weapon}`);
      await page.keyboard.down('Space');
      await page.waitForFunction(({ weapon, ammo }) => window.__rb2Defense.state.weapons[weapon].ammo < ammo, { weapon, ammo: before.weapons[weapon].ammo });
      await page.keyboard.up('Space');
      const after = await raid(`fired ${weapon}`);
      assert.equal(after.selected, weapon);
      return { weapon, before: before.weapons[weapon].ammo, after: after.weapons[weapon].ammo };
    }

    try {
      const cdp = await browser.newBrowserCDPSession();
      try {
        report.browser = { version: browser.version(), userAgent: (await cdp.send('Browser.getVersion')).userAgent, gpu: (await cdp.send('SystemInfo.getInfo')).gpu.devices };
      } finally { await cdp.detach(); }
      report.checkpoint = 'initial navigation';
      await page.goto(url);
      await page.getByRole('button', { name: /Airfield Defense/ }).click();
      const briefing = page.locator('[data-screen="defense-briefing"]:not(.leaving)');
      await briefing.locator('#defense-seed').fill('1917');
      await briefing.getByRole('button', { name: 'Regular', exact: true }).click();
      await briefing.getByRole('button', { name: 'Visual hint', exact: true }).click();

      for (let index = 0; index < 2; index++) {
        const pass = { kind: index === 0 ? 'initial' : 'same-page replay', guns: [], screenshots: [] };
        report.passes.push(pass);
        report.checkpoint = `${pass.kind}: ready`;
        const readyStarted = performance.now();
        if (index === 0) await briefing.locator('[data-action="defense-launch"]').click();
        else await page.locator('[data-screen="defense-report"]:not(.leaving) [data-action="defense-replay"]').click();
        await waitForDefenseReady(page);
        pass.readyMs = Math.round(performance.now() - readyStarted);
        const fresh = await raid('fresh simulation');
        assert.deepEqual(fresh.options, { seed: 1917, difficulty: 'regular', aimAssist: true });
        assert.equal(fresh.paused, true);
        assert.equal(fresh.capture, false);
        assert.equal(fresh.time, 0);
        assert.equal(fresh.raidTime, 0);
        assert.ok(Object.values(fresh.counters).every(value => value === 0), 'Replay counters must reset');
        assert.ok(Object.values(fresh.upgrades).every(value => value === 0), 'Run upgrades must reset');
        for (const gun of Object.values(fresh.weapons)) assert.equal(gun.ammo, gun.capacity, 'Each run starts with full authoritative capacity');
        pass.fresh = fresh;
        await settledViewport(1280, 720);
        const pointer = await resume();

        let before = await raid('mouse aim');
        // Keep the exercise relative to the trusted click, not a viewport jump.
        await page.mouse.move(pointer.x + 12, pointer.y);
        await page.waitForFunction(pose => {
          const r = window.__rb2Defense.scene.camera.rotation;
          return r.x !== pose[0] || r.y !== pose[1] || r.z !== pose[2];
        }, before.pose);
        pass.mouseAim = { before: before.pose, after: (await snapshot(page)).pose };
        before = await raid('held arrow aim');
        await page.keyboard.down('ArrowLeft');
        await page.waitForFunction(pose => window.__rb2Defense.scene.camera.rotation.y !== pose[1], before.pose);
        await page.keyboard.up('ArrowLeft');
        pass.arrowAim = { before: before.pose, after: (await snapshot(page)).pose };

        before = await raid('mouse chord');
        await page.mouse.down({ button: 'right' });
        await page.waitForFunction(fov => window.__rb2Defense.scene.camera.fov < fov, before.fov);
        await page.mouse.down({ button: 'left' });
        await page.waitForFunction(ammo => window.__rb2Defense.state.weapons.mg.ammo < ammo, before.weapons.mg.ammo);
        await page.mouse.up({ button: 'left' });
        const released = await snapshot(page);
        await page.waitForTimeout(180);
        assert.equal((await raid('independent chord release')).weapons.mg.ammo, released.weapons.mg.ammo);
        assert.ok((await snapshot(page)).fov < before.fov, 'Right focus remains held after left release');
        await page.mouse.up({ button: 'right' });
        await page.waitForFunction(fov => window.__rb2Defense.scene.camera.fov === fov, before.fov);
        pass.mouseChord = { normalFov: before.fov, focusedFov: released.fov, ammoBefore: before.weapons.mg.ammo, ammoAfter: released.weapons.mg.ammo };
        pass.guns.push(await keyboardFire('mg'));
        report.checkpoint = 'R reload';
        await page.keyboard.press('KeyR');
        await page.waitForFunction(() => window.__rb2Defense.state.weapons.mg.reloadLeft > 0);
        await page.waitForFunction(() => {
          const gun = window.__rb2Defense.state.weapons.mg;
          return gun.reloadLeft === 0 && gun.ammo === gun.capacity;
        });
        pass.reload = (await raid('reloaded')).weapons.mg;
        await select('Digit2', 'cannon');
        pass.guns.push(await keyboardFire('cannon'));
        await select('Digit3', 'flak');
        pass.guns.push(await keyboardFire('flak'));

        before = await raid('wheel fuze');
        await page.mouse.wheel(0, 120);
        await page.waitForFunction(fuze => window.__rb2Defense.state.fuzeRange !== fuze, before.fuze);
        const wheeled = await raid('F range');
        assert.ok(wheeled.target?.health > 0, 'F must range a real tracked threat');
        await page.keyboard.press('KeyF');
        await page.waitForFunction(fuze => window.__rb2Defense.state.fuzeRange !== fuze, wheeled.fuze);
        pass.range = { wheelBefore: before.fuze, wheelAfter: wheeled.fuze, target: wheeled.target, ranged: (await snapshot(page)).fuze };

        await select('Digit1', 'mg');
        before = await raid('held fire before pause');
        await page.keyboard.down('Space');
        await page.waitForFunction(ammo => window.__rb2Defense.state.weapons.mg.ammo < ammo, before.weapons.mg.ammo);
        await pause();
        await page.keyboard.up('Space');
        const paused = await snapshot(page);
        await page.waitForTimeout(180);
        assert.equal((await snapshot(page)).time, paused.time, 'Pause must freeze combat');
        await resume();
        const resumed = await snapshot(page);
        await page.waitForTimeout(180);
        assert.equal((await raid('no stale fire')).weapons.mg.ammo, resumed.weapons.mg.ammo);
        pass.pause = { time: paused.time, releasedCapture: !paused.capture, resumedAmmo: resumed.weapons.mg.ammo };

        await pause();
        await page.getByRole('button', { name: 'Use keyboard controls', exact: true }).click();
        await page.waitForFunction(() => !window.__rb2Defense.paused && !document.pointerLockElement);
        before = await raid('keyboard slider');
        const slider = page.getByRole('slider', { name: 'Flak airburst distance' });
        await slider.focus();
        await slider.press('ArrowRight');
        await page.waitForFunction(fuze => window.__rb2Defense.state.fuzeRange !== fuze, before.fuze);
        pass.slider = { before: before.fuze, after: (await snapshot(page)).fuze };
        await page.locator('.defense-canvas').focus();
        await pause();
        await resume();
        pass.screenshots.push(await capture(`pass-${index + 1}-desktop`));
        await pause();
        await page.setViewportSize({ width: 430, height: 900 });
        await settledViewport(430, 900);
        await resume();
        pass.screenshots.push(await capture(`pass-${index + 1}-narrow`));
        await pause();
        await page.setViewportSize({ width: 1280, height: 720 });
        await settledViewport(1280, 720);
        report.checkpoint = 'abort teardown';
        await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
        const result = page.locator('[data-screen="defense-report"]:not(.leaving)');
        await result.waitFor({ state: 'visible' });
        await page.waitForTimeout(500);
        assert.equal(await result.locator('.defense-report-paper').getAttribute('data-outcome'), 'aborted');
        assert.equal((await result.locator('[data-defense-seed]').textContent()).trim(), '1917');
        assert.equal(await result.getByText('Regular', { exact: true }).isVisible(), true);
        assert.equal(await result.getByText('Visual hint only', { exact: true }).isVisible(), true);
        const teardown = await page.evaluate(() => ({ hook: !!window.__rb2Defense, canvas: !!document.querySelector('.defense-canvas'), host: !!document.querySelector('[data-session="airfield-defense"]'), capture: !!document.pointerLockElement }));
        assert.deepEqual(teardown, { hook: false, canvas: false, host: false, capture: false });
        pass.teardown = teardown;
        checkErrors();
      }
      report.checkpoint = 'complete';
      checkErrors();
    } catch (error) {
      report.failure = error?.stack ?? String(error);
      try { report.lastObservation = await snapshot(page); } catch (observationError) { report.observationError = String(observationError); }
      try { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: false }); } catch (captureError) { report.failureCaptureError = String(captureError); }
      throw error;
    }
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error?.stack ?? String(error);
  if (error instanceof AggregateError) report.failures = error.errors.map(value => value?.stack ?? String(value));
  process.exitCode = 1;
} finally {
  report.totalMs = Math.round(performance.now() - started);
  report.browserClosed = ownedBrowser ? !ownedBrowser.isConnected() : null;
  try { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); }
  catch (artifactError) { console.error(`Could not save report: ${artifactError.message}`); process.exitCode = 1; }
  console.log(JSON.stringify({ status: report.status, checkpoint: report.checkpoint, browserSetupMs: report.browserSetupMs, readyMs: report.passes.map(pass => pass.readyMs), totalMs: report.totalMs, browserClosed: report.browserClosed, report: resolve(out, 'report.json'), failure: report.failure }, null, 2));
}
