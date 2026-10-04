import { expect, test, waitForFlightReady, type CDPSession, type Page } from './fixtures';

// Chromium emulation proves browser interaction, not physical iPhone acceptance.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type TouchPoint = { x: number; y: number; id: number };
async function centre(page: Page, selector: string, id: number): Promise<TouchPoint> {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`No visible touch target: ${selector}`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id };
}
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: TouchPoint[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}
async function action(page: Page, command: string): Promise<void> {
  await page.locator('[data-touch="menu"]').tap();
  await expect(page.locator('[data-touch="sheet"]')).toBeVisible();
  await page.locator(`[data-touch-action="${command}"]`).tap();
  await expect(page.locator('[data-touch="sheet"]')).toBeHidden();
}
async function startRaid(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('button:has-text("Quick Mission")').tap();
  await expect(page.locator('[data-screen="quick"]:not(.leaving)')).toBeVisible();
  await page.locator('button:has-text("Bombing raid")').tap();
  await page.selectOption('select[aria-label="Your aircraft"]', 'dh4');
  await page.locator('button:has-text("To the briefing")').tap();
  await page.locator('button:has-text("Take off")').tap();
  const primer = page.locator('.rb-modal:has-text("Flying School")');
  await primer.locator('button:has-text("Understood")').tap();
  await waitForFlightReady(page);
  await expect(page.locator('[data-touch="stick"]')).toBeVisible();
}

test('touch-only raid route: crew, bombs, map, pause menu and debrief', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startRaid(page);
  await action(page, 'stationNext');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.station)).toBe('observer');
  await expect(page.locator('[data-touch="station"]')).toContainText(/observer/i);
  await action(page, 'viewBombsight');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.cameraMode)).toBe('bombsight');
  const before = await page.evaluate(() => window.__rb2!.session!.player!.bombs!.reduce((sum, count) => sum + count, 0));
  await action(page, 'releaseBomb');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.bombs!.reduce((sum, count) => sum + count, 0))).toBeLessThan(before);
  await action(page, 'stationPilot');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.station)).toBe('pilot');

  await action(page, 'map');
  await expect(page.locator('.hud-map')).toBeVisible();
  await expect(page.locator('[data-touch="flight"]')).toBeHidden();
  await page.locator('[data-touch="menu"]').tap();
  await expect(page.locator('.hud-map')).toBeHidden();
  await expect(page.locator('[data-touch="flight"]')).toBeVisible();

  await action(page, 'toggleHud');
  await expect(page.locator('.rb-hud')).toBeHidden();
  await expect(page.locator('[data-touch="menu"]')).toBeVisible();
  await action(page, 'toggleHud');
  await expect(page.locator('.rb-hud')).toBeVisible();
  await page.locator('[data-touch="menu"]').tap();
  const time = await page.evaluate(() => window.__rb2!.session!.time);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__rb2!.session!.time)).toBe(time);
  await page.locator('[data-touch="resume"]').tap();
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.time)).toBeGreaterThan(time);

  await page.setViewportSize({ width: 844, height: 390 });
  await action(page, 'toggleHud');
  await expect(page.locator('.rb-hud')).toBeHidden();
  await action(page, 'endFlight');
  await expect(page.locator('.hud-card[aria-label="End flight"]')).toBeVisible();
  await page.locator('.hud-card button.primary:has-text("End flight")').tap();
  await expect(page.locator('[data-screen="debrief"]:not(.leaving)')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-touch="controls"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('returning from touch UI restores keyboard flight shortcuts', async ({ page }) => {
  await startRaid(page);
  for (const exit of ['resume', 'escape', 'hide']) {
    if (exit === 'hide') {
      await page.locator('[data-touch="toggle"]').tap();
    } else {
      await page.locator('[data-touch="menu"]').tap();
      if (exit === 'resume') await page.locator('[data-touch="resume"]').tap();
      else await page.keyboard.press('Escape');
    }
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(true);
    await page.keyboard.up('Space');
    await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(false);
  }
});

test('keyboard closes the captured map on a touch-capable device', async ({ page }) => {
  await startRaid(page);
  await page.locator('[data-touch="toggle"]').tap();
  await page.locator('.rb-flight canvas').focus();
  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-map')).toBeVisible();
  const time = await page.evaluate(() => window.__rb2!.session!.time);
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__rb2!.session!.time)).toBe(time);
  expect(await page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(false);
  await page.keyboard.up('Space');
  await page.locator('[data-touch="toggle"]').tap(); // Toolbar keeps focus while the map is captured.
  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-map')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.time)).toBeGreaterThan(time);
});

test('keyboard autorepeat cannot reassert bomb release after a seat change', async ({ page }) => {
  await startRaid(page);
  await action(page, 'stationNext');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.station)).toBe('observer');
  await page.locator('.rb-flight canvas').focus();
  const bombs = () => page.evaluate(() => window.__rb2!.session!.player!.bombs!.reduce((sum, count) => sum + count, 0));
  const before = await bombs();
  await page.keyboard.down('KeyR');
  await expect.poll(bombs).toBe(before - 1);
  await action(page, 'stationPilot');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.station)).toBe('pilot');
  await action(page, 'stationNext');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.station)).toBe('observer');
  await page.locator('.rb-flight canvas').focus();
  await page.keyboard.down('KeyR'); // Still physically down: Chromium sends a repeat.
  await page.waitForTimeout(150);
  expect(await bombs()).toBe(before - 1);
  await page.keyboard.up('KeyR');
  await page.keyboard.down('KeyR');
  await expect.poll(bombs).toBe(before - 2);
  await page.keyboard.up('KeyR');
});

test('controller Back closes a captured map without applying flight input', async ({ browser, baseURL }) => {
  // A dedicated context replaces physical pads with a controllable pad before startup.
  const context = await browser.newContext({ baseURL, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  try {
    await context.addInitScript(() => {
      const pad = { index: 0, id: 'hybrid controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    });
    const page = await context.newPage();
    await startRaid(page);
    await page.locator('[data-touch="toggle"]').tap();
    const back = (pressed: boolean) => page.evaluate((held) => {
      Object.assign(navigator.getGamepads()[0]!.buttons[8], { pressed: held });
    }, pressed);
    await page.waitForTimeout(100);
    await back(true);
    await expect(page.locator('.hud-map')).toBeVisible();
    await back(false);
    const time = await page.evaluate(() => window.__rb2!.session!.time);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__rb2!.session!.time)).toBe(time);
    await back(true);
    await expect(page.locator('.hud-map')).toBeHidden();
    await back(false);
    await expect.poll(() => page.evaluate(() => window.__rb2!.session!.time)).toBeGreaterThan(time);
  } finally {
    await context.close();
  }
});

test('simultaneous touch owners survive partial release and cancel on rotation', async ({ page, context }) => {
  await startRaid(page);
  const cdp = await context.newCDPSession(page);
  const fire1 = await centre(page, '[data-touch="fire"]', 1);
  const fire2 = { ...fire1, x: fire1.x + 5, id: 2 };
  const stick = await centre(page, '[data-touch="stick"]', 3);
  stick.x += 25;
  const look = await centre(page, '[data-touch="look"]', 4);
  look.y -= 15;
  await touch(cdp, 'touchStart', [fire1]);
  await touch(cdp, 'touchStart', [fire1, fire2]);
  await touch(cdp, 'touchStart', [fire1, fire2, stick]);
  await touch(cdp, 'touchStart', [fire1, fire2, stick, look]);
  await expect(page.locator('[data-touch="fire"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.roll)).toBeGreaterThan(0);
  // Chromium's partial touchEnd releases the supplied IDs, not the remaining set.
  await touch(cdp, 'touchEnd', [fire1]);
  await expect(page.locator('[data-touch="fire"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(true);
  await touch(cdp, 'touchEnd', [fire2]);
  await expect(page.locator('[data-touch="fire"]')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.fireGuns)).toBe(false);
  const left = await centre(page, '[data-touch="rudderLeft"]', 7);
  const right = await centre(page, '[data-touch="rudderRight"]', 8);
  await touch(cdp, 'touchStart', [stick, look, left]);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.yaw)).toBeLessThan(0);
  await touch(cdp, 'touchStart', [stick, look, left, right]);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.yaw)).toBe(0);
  await touch(cdp, 'touchEnd', [left]);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.yaw)).toBeGreaterThan(0);
  await touch(cdp, 'touchCancel', []);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.roll)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.yaw)).toBe(0);

  const throttle = await centre(page, '[data-touch="throttle"]', 9);
  await touch(cdp, 'touchStart', [throttle]);
  throttle.x -= 35;
  await touch(cdp, 'touchMove', [throttle]);
  await touch(cdp, 'touchEnd', []);
  const displayed = await page.locator('[data-touch="throttle"]').inputValue();
  expect(Number(displayed)).toBeLessThan(50);
  await expect(page.locator('[data-touch="throttle-value"]')).toHaveText(`${displayed}%`);
  await expect.poll(() => page.evaluate(() => window.__rb2!.session!.player!.controls.throttle)).toBeCloseTo(Number(displayed) / 100, 2);

  const nextFire = await centre(page, '[data-touch="fire"]', 5);
  await touch(cdp, 'touchStart', [nextFire]);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('[data-touch="fire"]')).toHaveAttribute('aria-pressed', 'false');
  await touch(cdp, 'touchEnd', []);

  // A cancelled toolbar down must not become a command on its late release.
  const menu = await centre(page, '[data-touch="menu"]', 6);
  await touch(cdp, 'touchStart', [menu]);
  await page.setViewportSize({ width: 846, height: 390 });
  await touch(cdp, 'touchEnd', []);
  await expect(page.locator('[data-touch="sheet"]')).toBeHidden();
  await page.locator('[data-touch="menu"]').tap();
  await expect(page.locator('[data-touch="sheet"]')).toBeVisible();
  await page.locator('[data-touch="resume"]').tap();

  await page.locator('[data-touch="toggle"]').tap();
  await expect(page.locator('[data-touch="flight"]')).toBeHidden();
  await expect(page.locator('[data-touch="toggle"]')).toBeVisible();
  await page.locator('[data-touch="toggle"]').tap();
  await expect(page.locator('[data-touch="flight"]')).toBeVisible();
  await action(page, 'endFlight');
  await page.locator('.hud-card button.primary:has-text("End flight")').tap();
  await expect(page.locator('[data-screen="debrief"]:not(.leaving)')).toBeVisible({ timeout: 30_000 });
  await cdp.detach();
});
