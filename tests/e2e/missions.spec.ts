import { expect, test, type Page } from '@playwright/test';

/**
 * In-flight mission rules in the real browser game (real sim, AI, renderer, HUD):
 *  - wingman orders change AI behaviour and are acknowledged on the radio;
 *  - time compression works when clear and is refused with enemies near;
 *  - "end flight" is refused near enemies; abandoning is an aborted, failed mission;
 *  - landing on the home aerodrome ends the flight as "returned";
 *  - a career balloon attack spawns its balloons on the enemy side and runs at x8.
 * Flights are launched straight through GameServices.launcher (window.__rb2.services)
 * into a full-screen host above the menus, so these tests don't depend on menu layout.
 */

type Win = Window & { __result?: unknown; __host?: HTMLElement };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
}

/** Start a quick mission from options; resolves once the flight is running. */
async function flyQuick(page: Page, opts: Record<string, unknown>): Promise<void> {
  await page.evaluate((o) => {
    const s = window.__rb2!.services!;
    const m = s.campaign.buildQuickMission(o as never);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.appendChild(host);
    (window as Win).__host = host;
    (window as Win).__result = undefined;
    void s.launcher.fly(m, s.getSettings(), host).then((r) => ((window as Win).__result = r));
  }, opts);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
}

async function hudText(page: Page): Promise<string> {
  return page.locator('.rb-hud').innerText();
}

async function wingmanStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const s = window.__rb2!.session!;
    const p = s.player!;
    return (s.world.flightMembers.get(p.flightId) ?? []).filter((a) => a !== p).map((a) => s.aiState(a.id) ?? '');
  });
}

async function result(page: Page): Promise<Record<string, unknown>> {
  await page.waitForFunction(() => (window as Win).__result !== undefined, undefined, { timeout: 30_000 });
  return page.evaluate(() => (window as Win).__result as Record<string, unknown>);
}

const BASE = { enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2000, timeOfDay: 'midday', cloudCover: 0.2 };

test('wingman orders, time compression and landing at home', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  // Escort: the enemy flight spawns later, so the sky is clear at the start.
  await flyQuick(page, { ...BASE, type: 'escort', playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 2, wingmen: 2, startPosition: 'random' });
  await page.waitForFunction(() => window.__rb2!.session!.time > 3, undefined, { timeout: 30_000 });

  // Time compression steps up while clear, and back down on request.
  await page.evaluate(() => window.__rb2!.session!.command('timeCompress'));
  await page.evaluate(() => window.__rb2!.session!.command('timeCompress'));
  expect(await page.evaluate(() => window.__rb2!.session!.timeScale)).toBe(4);
  const t0 = await page.evaluate(() => window.__rb2!.session!.time);
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => window.__rb2!.session!.time);
  expect(t1 - t0).toBeGreaterThan(4); // clearly faster than real time
  await page.evaluate(() => window.__rb2!.session!.command('timeNormal'));
  expect(await page.evaluate(() => window.__rb2!.session!.timeScale)).toBe(1);

  // Wingman orders: acknowledged on the radio, and the AI changes what it is doing.
  await page.evaluate(() => window.__rb2!.session!.command('wingmenFormUp'));
  await expect.poll(() => hudText(page), { timeout: 5000 }).toMatch(/Forming up on you/);
  await page.evaluate(() => window.__rb2!.session!.command('wingmenHome'));
  await expect.poll(() => hudText(page), { timeout: 5000 }).toMatch(/Returning to the aerodrome/);
  await expect.poll(async () => (await wingmanStates(page)).every((s) => /rtb|landing/.test(s)), { timeout: 5000 }).toBe(true);
  await page.screenshot({ path: 'test-results/missions-orders.png' });

  // Put the player down on the home field: the flight ends as a safe return.
  expect(await page.evaluate(() => window.__rb2!.session!.placeAtHome())).toBe(true);
  const r = await result(page);
  expect(r.playerOutcome).toBe('landed-friendly');
  expect(r.playerFate).toBe('returned');
  expect(errors).toEqual([]);
});

test('enemies near: no compression, no end flight; abandoning fails the mission', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await flyQuick(page, { ...BASE, type: 'dogfight', playerAircraft: 'se5a', enemyAircraft: 'albatros_dv', enemyCount: 2, wingmen: 1, startPosition: 'head-on' });
  // The wingman calls the bounce as soon as the enemy is within 5 km (messages fade after a while).
  await expect.poll(() => hudText(page), { timeout: 30_000 }).toMatch(/Enemy aircraft!/);
  // Head-on start ~5 km apart: wait until they're inside the compression-safe range.
  await page.waitForFunction(
    () => {
      const s = window.__rb2!.session!;
      const p = s.player!;
      return s.world.aircraft.some((a) => a.side !== p.side && a.outcome === null && a.state.position.distanceTo(p.state.position) < 3800);
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.evaluate(() => window.__rb2!.session!.command('timeCompress'));
  expect(await page.evaluate(() => window.__rb2!.session!.timeScale)).toBe(1);
  await expect.poll(() => hudText(page), { timeout: 5000 }).toMatch(/time compression/i);
  expect(await page.evaluate(() => window.__rb2!.session!.endFlight())).toBe(false);
  await page.screenshot({ path: 'test-results/missions-contact.png' });

  await page.evaluate(() => window.__rb2!.session!.abandon());
  const r = await result(page);
  expect(r.aborted).toBe(true);
  expect(r.missionSuccess).toBe(false);
  expect(['landed-elsewhere', 'captured', 'wounded']).toContain(r.playerFate);
  expect(errors).toEqual([]);
});

test('career balloon attack: balloons on the enemy side, flies at x8 without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  const info = await page.evaluate(() => {
    const s = window.__rb2!.services!;
    // A scout squadron and a fixed seed: a random two-seater squadron rarely flies balloon attacks.
    const p = s.campaign.createPilot({ firstName: 'Test', lastName: 'Balloonbuster', nation: 'britain', startDate: '1917-09-15', squadronId: 'rfc56', difficulty: 'pilot' });
    p.rngSeed = 1917;
    let m = s.campaign.generateMission(p);
    for (let i = 0; i < 200 && m.type !== 'balloon-attack'; i++) {
      p.missionsFlown++;
      m = s.campaign.generateMission(p);
    }
    s.campaign.deletePilot(p.id);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.appendChild(host);
    void s.launcher.fly(m, s.getSettings(), host).then((r) => ((window as Win).__result = r));
    return { type: m.type, balloons: m.balloons.map((b) => b.side), wp: m.flights[0].waypoints.map((w) => w.label ?? '') };
  });
  expect(info.type).toBe('balloon-attack');
  expect(info.balloons.length).toBeGreaterThan(0);
  expect(info.balloons.every((s) => s === 'central')).toBe(true);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__rb2!.session!.world.balloons.length)).toBe(info.balloons.length);
  // The HUD shows the first waypoint of the route.
  await expect.poll(() => hudText(page), { timeout: 5000 }).toContain(info.wp[0]);

  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__rb2!.session!.command('timeCompress'));
  const scale = await page.evaluate(() => window.__rb2!.session!.timeScale);
  const t0 = await page.evaluate(() => window.__rb2!.session!.time);
  await page.waitForTimeout(4000);
  const t1 = await page.evaluate(() => window.__rb2!.session!.time);
  // At x8 the sim must keep up (not stall the frame loop); allow for auto-drop if enemies appear.
  if (scale === 8 && (await page.evaluate(() => window.__rb2!.session!.timeScale)) === 8) expect(t1 - t0).toBeGreaterThan(16);
  await page.screenshot({ path: 'test-results/missions-balloon.png' });
  await page.evaluate(() => window.__rb2!.session!.abandon());
  await result(page);
  expect(errors).toEqual([]);
});
