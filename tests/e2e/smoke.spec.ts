import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test: the app boots, a quick mission launches through the
 * FlightLauncher (independent of which UI is mounted), flies for 10 s of
 * game time without console errors, renders a non-blank frame, and ends
 * with a MissionResult.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('boots, flies a quick mission and ends cleanly', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rb2?.services);
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.screenshot({ path: 'test-results/menu.png' });

  // Launch a quick mission directly through the services (UI-agnostic).
  await page.evaluate(() => {
    const s = window.__rb2!.services!;
    const mission = s.campaign.buildQuickMission({
      playerAircraft: 'sopwith_camel',
      enemyAircraft: 'albatros_dv',
      enemyCount: 2,
      wingmen: 1,
      enemySkill: 'regular',
      wingmanSkill: 'regular',
      altitudeM: 1500,
      startPosition: 'head-on',
      timeOfDay: 'morning',
      cloudCover: 0.3,
      type: 'dogfight',
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    (window as unknown as { __result: Promise<unknown> }).__result = s.launcher.fly(mission, s.getSettings(), host).then((r) => {
      (window as unknown as { __done: unknown }).__done = r;
      host.remove();
      return r;
    });
  });

  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 30_000 });
  // Hold full throttle, fire a burst, cycle views.
  await page.keyboard.down('Equal');
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  await page.keyboard.press('F2');
  await page.waitForFunction(() => (window.__rb2?.session?.time ?? 0) >= 10, undefined, { timeout: 60_000 });
  await page.keyboard.up('Equal');

  const stats = await page.evaluate(() => window.__rb2!.session!.samplePixels());
  expect(stats.nonBlack).toBeGreaterThan(stats.total * 0.5);
  expect(stats.distinctColors).toBeGreaterThan(8);
  await page.screenshot({ path: 'test-results/flight-chase.png' });
  await page.keyboard.press('F1');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/flight-cockpit.png' });

  const state = await page.evaluate(() => {
    const p = window.__rb2!.session!.player!;
    return { alt: p.state.altitude, speed: p.state.airspeed, outcome: p.outcome };
  });
  expect(state.alt).toBeGreaterThan(100);

  await page.evaluate(() => window.__rb2!.session!.abandon());
  const result = (await page.waitForFunction(() => (window as unknown as { __done?: unknown }).__done, undefined, { timeout: 10_000 }).then((h) => h.jsonValue())) as {
    playerFate: string;
    flightTimeS: number;
    roundsFired: number;
  };
  expect(result.flightTimeS).toBeGreaterThanOrEqual(10);
  expect(result.roundsFired).toBeGreaterThan(0);
  expect(['returned', 'captured', 'wounded', 'landed-elsewhere', 'killed']).toContain(result.playerFate);
  expect(errors).toEqual([]);
});
