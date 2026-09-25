import { expect, test, type Page } from '@playwright/test';

/**
 * Failure handling in the real browser game (docs/game.md "Robustness"):
 *  - an exception inside a frame ends the flight with the "Flight interrupted"
 *    card, records nothing, and leaves a working app (a second flight flies);
 *  - a lost WebGL context is survived when the browser restores it, and ends
 *    the flight cleanly when it doesn't;
 *  - a missing aircraft model falls back to the procedural mesh;
 *  - no WebAudio still boots and flies (silent engine);
 *  - an uncaught error outside a flight shows the recoverable fatal overlay
 *    whose "Return to menu" remounts the menus.
 */

type Win = Window & { __result?: unknown; __error?: string };

function collectErrors(page: Page, allow: RegExp[] = []): string[] {
  const errors: string[] = [];
  const ok = (t: string) => t.startsWith('Failed to load resource') || allow.some((r) => r.test(t));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ok(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!ok(e.message)) errors.push(e.message);
  });
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
}

async function fly(page: Page, aircraft = 'sopwith_camel'): Promise<void> {
  await page.evaluate((ac) => {
    const s = window.__rb2!.services!;
    const m = s.campaign.buildQuickMission({
      playerAircraft: ac as never,
      enemyAircraft: 'albatros_dv',
      enemyCount: 1,
      wingmen: 0,
      enemySkill: 'novice',
      wingmanSkill: 'regular',
      altitudeM: 1500,
      startPosition: 'head-on',
      timeOfDay: 'morning',
      cloudCover: 0.2,
      type: 'dogfight',
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.appendChild(host);
    const w = window as Win;
    w.__result = undefined;
    w.__error = undefined;
    s.launcher.fly(m, s.getSettings(), host).then(
      (r) => ((w.__result = r), host.remove()),
      (e) => ((w.__error = String(e)), host.remove()),
    );
  }, aircraft);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 40_000 });
}

async function settled(page: Page): Promise<{ result?: unknown; error?: string }> {
  await page.waitForFunction(() => (window as Win).__result !== undefined || (window as Win).__error !== undefined, undefined, { timeout: 30_000 });
  return page.evaluate(() => ({ result: (window as Win).__result, error: (window as Win).__error }));
}

test('an error inside a frame interrupts the flight cleanly and the app stays usable', async ({ page }) => {
  const errors = collectErrors(page, [/Flight session failed/, /injected frame fault/]);
  await boot(page);
  await fly(page);
  await page.evaluate(() => window.__rb2!.session!.throwNextFrame('injected frame fault'));
  const r = await settled(page);
  expect(r.error).toContain('injected frame fault');
  const card = page.locator('#rb-flight-error');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Flight interrupted');
  await expect(page.locator('.rb-flight')).toHaveCount(0);
  await card.getByRole('button', { name: 'Return to menu' }).click();
  await expect(card).toHaveCount(0);
  // A second flight works after the failure.
  await fly(page);
  await page.evaluate(() => window.__rb2!.session!.abandon());
  expect((await settled(page)).result).toBeTruthy();
  expect(errors).toEqual([]);
});

test('survives a WebGL context loss that the browser restores', async ({ page }) => {
  const errors = collectErrors(page, [/CONTEXT_LOST_WEBGL/i, /context lost/i]);
  await boot(page);
  await fly(page);
  await page.evaluate(() => window.__rb2!.session!.simulateContextLoss(600));
  await page.waitForTimeout(300);
  const lostAt = await page.evaluate(() => window.__rb2!.session!.time);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ t: window.__rb2!.session!.time, f: window.__rb2!.session!.frames }));
  expect(after.t).toBeGreaterThan(lostAt + 1); // simulation resumed
  const px = await page.evaluate(() => window.__rb2!.session!.samplePixels());
  expect(px.nonBlack).toBeGreaterThan(px.total * 0.5); // and it draws again
  await page.evaluate(() => window.__rb2!.session!.abandon());
  expect((await settled(page)).result).toBeTruthy();
  expect(errors).toEqual([]);
});

test('ends the flight cleanly when the WebGL context never comes back', async ({ page }) => {
  collectErrors(page);
  await boot(page);
  await fly(page);
  await page.evaluate(() => window.__rb2!.session!.simulateContextLoss(null));
  const r = await settled(page);
  expect(r.error).toContain('graphics device');
  await expect(page.locator('#rb-flight-error')).toBeVisible();
  await expect(page.locator('.rb-flight')).toHaveCount(0);
});

test('a missing aircraft model falls back to the procedural mesh', async ({ page }) => {
  const errors = collectErrors(page);
  await page.route('**/models/sopwith_camel.glb', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await boot(page);
  await fly(page, 'sopwith_camel');
  const vis = await page.evaluate(() => {
    const s = window.__rb2!.session!;
    const v = s.visuals.get(s.player!.id)!;
    let meshes = 0;
    v.object.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    return { meshes };
  });
  expect(vis.meshes).toBeGreaterThan(5);
  await page.evaluate(() => window.__rb2!.session!.abandon());
  expect((await settled(page)).result).toBeTruthy();
  expect(errors).toEqual([]);
});

test('boots and flies with no WebAudio (silent engine)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  });
  await boot(page);
  await page.mouse.click(10, 10); // first gesture: the UI tries to resume audio
  await fly(page);
  await page.keyboard.down('Space');
  await page.waitForTimeout(800);
  await page.keyboard.up('Space');
  await page.evaluate(() => window.__rb2!.session!.abandon());
  expect((await settled(page)).result).toBeTruthy();
  expect(errors).toEqual([]);
});

test('an uncaught error outside a flight offers a working "Return to menu"', async ({ page }) => {
  collectErrors(page, [/injected menu fault/]);
  await boot(page);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('injected menu fault');
    });
  });
  const overlay = page.locator('#rb-fatal');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('injected menu fault');
  await overlay.getByRole('button', { name: 'Return to menu' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.rb-ui')).toHaveCount(1);
  await expect(page.locator('.rb-ui')).toBeVisible();
  // Benign browser noise is ignored.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('ResizeObserver loop completed with undelivered notifications.');
    });
  });
  await page.waitForTimeout(300);
  await expect(overlay).toHaveCount(0);
});
