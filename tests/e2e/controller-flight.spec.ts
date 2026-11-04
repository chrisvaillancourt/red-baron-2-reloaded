import type { Browser } from '@playwright/test';
import { expect, test, waitForFlightReady, type Page } from './fixtures';

/**
 * A standard controller in flight (Q-13): the menu's pad keeps ownership into the flight,
 * Menu opens pause and then Flight actions, B backs out, each action group dispatches once,
 * the contextual hint follows the crew station, disconnect and blur release held controls,
 * and a replayed flight binds afresh. Pads are stubbed before the app starts.
 */

type Win = Window & { __result?: unknown; __host?: HTMLElement };

async function controllerContext(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => {
    // Pad 0 appears only after the menu has pinned pad 1.
    const pads = [0, 1].map(index => ({ index, id: `flight controller ${index}`, connected: index === 1,
      mapping: 'standard', axes: [0, 0, 0, 0], timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads });
  });
  return context;
}

async function hold(page: Page, buttons: number[], pressed: boolean, controller = 1) {
  await page.evaluate(({ buttons, pressed, controller }) => {
    for (const index of buttons) Object.assign(navigator.getGamepads()[controller]!.buttons[index], { pressed, value: pressed ? 1 : 0 });
  }, { buttons, pressed, controller });
  await page.waitForTimeout(120);
}
async function tap(page: Page, button: number, controller = 1) {
  await page.waitForTimeout(120); // Let a newly mounted owner see a neutral frame.
  await hold(page, [button], true, controller);
  await hold(page, [button], false, controller);
}
async function stick(page: Page, x: number, controller = 1) {
  await page.evaluate(({ x, controller }) => { (navigator.getGamepads()[controller]!.axes as number[])[0] = x; }, { x, controller });
  await page.waitForTimeout(150);
}

const flight = (page: Page) => page.evaluate(() => {
  const s = window.__rb2!.session!;
  const c = s.player!.controls;
  return { paused: s.paused, mode: s.cameraMode, station: s.station, fire: c.fireGuns, roll: c.roll, throttle: c.throttle };
});

async function fly(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__rb2!.services!;
    const m = s.campaign.buildQuickMission({ type: 'dogfight', playerAircraft: 'bristol_f2b', enemyAircraft: 'albatros_dv',
      enemySkill: 'regular', wingmanSkill: 'regular', wingmen: 0, enemyCount: 1, altitudeM: 2000, timeOfDay: 'midday',
      cloudCover: 0.1, startPosition: 'head-on' } as never);
    // Hide the menus as the UI's own launch does, so only the flight HUD navigates.
    (document.querySelector('.rb-ui') as HTMLElement).hidden = true;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.appendChild(host);
    (window as Win).__host = host;
    (window as Win).__result = undefined;
    // Mouse off: no instructor adds its own stick to the controls under test.
    const settings = s.getSettings();
    void s.launcher.fly(m, { ...settings, controls: { ...settings.controls, mouseMode: 'off' } }, host).then((r) => ((window as Win).__result = r));
  });
  await waitForFlightReady(page);
}

async function end(page: Page): Promise<void> {
  await page.evaluate(() => window.__rb2!.session!.abandon());
  await page.waitForFunction(() => (window as Win).__result !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => (window as Win).__host?.remove());
}

const pauseCard = (page: Page) => page.locator('.hud-card[aria-label="Paused"]');
const actionsCard = (page: Page) => page.locator('.hud-actions');

async function openActions(page: Page) {
  await tap(page, 9);
  await expect(pauseCard(page)).toBeVisible();
  await pauseCard(page).getByRole('button', { name: 'Flight actions' }).focus();
  await tap(page, 0);
  await expect(actionsCard(page)).toBeVisible();
}
async function runAction(page: Page, action: string) {
  await openActions(page);
  await actionsCard(page).locator(`[data-flight-action="${action}"]`).focus();
  await tap(page, 0);
  await expect(page.locator('.hud-menu-backdrop')).toHaveCount(0);
  await expect.poll(async () => (await flight(page)).paused).toBe(false);
  await page.waitForTimeout(150); // The queued edge runs on the next frame.
}

test('controller flight: ownership, pause and Flight actions, hints, release and replay', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await controllerContext(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
    await page.waitForTimeout(200); // The title's navigation pins pad 1.
    // A lower-index standard pad appears and is busy; the menu pad holds RT and stick through launch.
    await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!, { connected: true }));
    await hold(page, [7], true, 0);
    await stick(page, -1, 0);
    await hold(page, [7, 0], true, 1);
    await stick(page, 0.8, 1);
    await fly(page);

    await test.step('menu owner inherited; held launch controls stay neutral until released', async () => {
      await page.waitForTimeout(300);
      expect(await flight(page)).toMatchObject({ fire: false, roll: 0 });
      await hold(page, [7, 0], false, 1);
      await stick(page, 0, 1);
      expect(await flight(page)).toMatchObject({ fire: false, roll: 0 }); // pad 0 still held: not the owner
      await hold(page, [7], true, 1);
      await stick(page, 0.8, 1);
      const s = await flight(page);
      expect(s.fire).toBe(true);
      expect(s.roll).toBeGreaterThan(0);
      await hold(page, [7], false, 1);
      await stick(page, 0, 1);
      await hold(page, [7], false, 0);
      await stick(page, 0, 0);
      // Pad 0 leaves, so a reconnect below cannot hand the flight to it.
      await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!, { connected: false }));
    });

    await test.step('pilot hint shows for a standard pad', async () => {
      await expect(page.locator('.hud-hint')).toContainText('Pilot: left stick flies');
    });

    await test.step('Menu opens pause, then Flight actions; B backs out to pause, then to flight', async () => {
      const before = await flight(page);
      await openActions(page);
      await tap(page, 1);
      await expect(pauseCard(page)).toBeVisible();
      await expect(actionsCard(page)).toHaveCount(0);
      await tap(page, 1);
      await expect(page.locator('.hud-menu-backdrop')).toHaveCount(0);
      await expect.poll(async () => (await flight(page)).paused).toBe(false);
      await page.waitForTimeout(200);
      expect((await flight(page)).mode).toBe(before.mode); // B did not also switch the view
    });

    await test.step('each action group dispatches exactly once', async () => {
      // Views & targets: one chase toggle, not chase then orbit.
      const mode = (await flight(page)).mode;
      await runAction(page, 'viewChase');
      expect((await flight(page)).mode).toBe(mode === 'chase' ? 'orbit' : 'chase');
      await page.evaluate(() => window.__rb2!.session!.command('viewCockpit'));
      // Navigation & time: the map opens (a second dispatch would close it); B closes it.
      await runAction(page, 'map');
      await expect(page.locator('.hud-map')).toBeVisible();
      await tap(page, 1);
      await expect(page.locator('.hud-map')).toHaveCount(0);
      // Crew & weapons: one seat forward; the hint follows, and B hands back to the pilot.
      await runAction(page, 'stationNext');
      expect((await flight(page)).station).toBe('observer');
      await expect(page.locator('.hud-hint')).toContainText('Gunner: left stick aims');
      await tap(page, 1);
      await expect.poll(async () => (await flight(page)).station).toBe('pilot');
      await expect(page.locator('.hud-hint')).toContainText('Pilot: left stick flies');
      // Engine.
      await runAction(page, 'throttleCut');
      await expect.poll(async () => (await flight(page)).throttle).toBe(0);
      // Wingmen: one refusal message without wingmen.
      await runAction(page, 'wingmenFormUp');
      await expect(page.locator('.hud-msg', { hasText: 'no wingmen' })).toHaveCount(1);
      // Flight: one HUD toggle.
      await runAction(page, 'toggleHud');
      await expect(page.locator('.rb-hud')).toBeHidden();
      await runAction(page, 'toggleHud');
      await expect(page.locator('.rb-hud')).toBeVisible();
    });

    await test.step('disconnect and blur release held controls until a fresh press', async () => {
      await hold(page, [7], true, 1);
      expect((await flight(page)).fire).toBe(true);
      await page.evaluate(() => Object.assign(navigator.getGamepads()[1]!, { connected: false }));
      await page.waitForTimeout(150);
      expect((await flight(page)).fire).toBe(false);
      await page.evaluate(() => Object.assign(navigator.getGamepads()[1]!, { connected: true }));
      await page.waitForTimeout(150);
      expect((await flight(page)).fire).toBe(false); // Still held across the reconnect.
      await hold(page, [7], false, 1);
      await hold(page, [7], true, 1);
      expect((await flight(page)).fire).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(150);
      expect((await flight(page)).fire).toBe(false);
      await hold(page, [7], false, 1);
    });

    await test.step('teardown into the debrief, then a replayed flight binds afresh', async () => {
      await end(page);
      await expect(page.locator('.rb-hud')).toHaveCount(0);
      await tap(page, 0); // A stale session's HUD and callbacks are gone: nothing may throw.
      await fly(page);
      await page.waitForTimeout(300);
      const mode = (await flight(page)).mode;
      await runAction(page, 'viewChase');
      expect((await flight(page)).mode).toBe(mode === 'chase' ? 'orbit' : 'chase');
      await page.screenshot({ path: 'test-results/controller-flight/after-replay.png' });
      await openActions(page);
      await page.screenshot({ path: 'test-results/controller-flight/actions-card.png' });
      await tap(page, 1);
      await tap(page, 1);
      await end(page);
    });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Flying Manual and Flying School controller prompts come from the mapped table', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Flying Manual/ }).click();
    const manual = page.locator('[data-screen="controls"]:not(.leaving)');
    const l3 = manual.locator('.key-grid .k', { has: page.locator('kbd', { hasText: /^L3$/ }) });
    await expect(l3).toHaveText(/cockpit view/i);
    await expect(manual).toContainText('Menu pauses the flight. On the pause card, B resumes and Flight actions lists the other commands');
    await expect(manual).not.toContainText('Menu opens the flight actions card');
    await manual.getByRole('button', { name: 'Flying School primer' }).click();
    const school = page.locator('.rb-modal:has-text("Flying School")');
    await expect(school.locator('[data-pad-lesson]')).toHaveCount(6);
    await expect(school.locator('[data-pad-lesson="V"]')).toContainText('L3 selects cockpit view');
    await expect(school).toContainText('press Menu and choose Flight actions');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/controller-flight/flying-school.png' });
  } finally { await context.close(); }
});

test('desktop map: flight inputs never drive the map; a fresh B, View or M closes it once', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await controllerContext(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
    await fly(page);
    const map = page.locator('.hud-map');
    // A connected but idle pad leaves the keyboard hint in place.
    await expect(page.locator('.hud-hint')).toContainText('Mouse to steer');

    await test.step('a held stick and A neither focus nor click Close map, and the pad stays armed', async () => {
      await tap(page, 8);
      await expect(map).toBeVisible();
      await expect(map.locator('.map-close')).toHaveAttribute('tabindex', '-1');
      await stick(page, 1);
      await page.waitForTimeout(1000);
      await tap(page, 0);
      await page.waitForTimeout(200);
      await expect(map).toBeVisible();
      expect((await flight(page)).roll).toBeGreaterThan(0.5);
      await stick(page, 0);
      await expect(page.locator('.hud-hint')).toContainText('Pilot: left stick flies');
    });

    await test.step('keyboard arrows and Enter do not reach Close map', async () => {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      await expect(map).toBeVisible();
    });

    await test.step('B closes the map once without changing the view', async () => {
      const mode = (await flight(page)).mode;
      await tap(page, 1);
      await expect(map).toHaveCount(0);
      await page.waitForTimeout(200);
      await expect(map).toHaveCount(0);
      expect((await flight(page)).mode).toBe(mode);
    });

    await test.step('at the observer gun, B closes the map and keeps the seat', async () => {
      await page.evaluate(() => window.__rb2!.session!.command('stationNext'));
      await expect.poll(async () => (await flight(page)).station).toBe('observer');
      await tap(page, 8);
      await expect(map).toBeVisible();
      await tap(page, 1);
      await expect(map).toHaveCount(0);
      await page.waitForTimeout(200);
      expect((await flight(page)).station).toBe('observer');
    });

    await test.step('View and M close it once; a mouse click on Close map still works', async () => {
      await tap(page, 8);
      await expect(map).toBeVisible();
      await tap(page, 8);
      await expect(map).toHaveCount(0);
      await page.keyboard.press('KeyM');
      await expect(map).toBeVisible();
      await page.keyboard.press('KeyM');
      await expect(map).toHaveCount(0);
      await tap(page, 8);
      await expect(map).toBeVisible();
      await map.locator('.map-close').click();
      await expect(map).toHaveCount(0);
    });
    await end(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
