import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end flows through the real UI, campaign and flight session:
 *  (a) Quick Mission screen -> briefing -> 15 s flight -> pause -> abandon -> debrief.
 *  (b) Career: enlist (German, 1917-04-01, Jasta 11) -> HQ -> briefing -> fly -> end flight
 *      -> debrief -> HQ shows one sortie; the pilot persists across a reload.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Missing optional art (public/art/*.jpg) is expected until the models agent lands.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function expectScreen(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want,
    id,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

async function currentScreen(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen'));
}

/** First take-off on a fresh profile shows the Flying School primer; acknowledge it. */
async function passFlyingSchool(page: Page): Promise<void> {
  const ok = page.locator('.rb-modal:has-text("Flying School") button:has-text("Understood")');
  await expect(ok).toBeVisible({ timeout: 5_000 });
  await ok.click();
}

async function waitForFlight(page: Page, seconds: number): Promise<void> {
  await page.waitForSelector('.rb-hud', { timeout: 30_000 });
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 30_000 });
  await page.waitForFunction((s) => (window.__rb2?.session?.time ?? 0) >= s, seconds, { timeout: 90_000 });
}

/** Step through debrief pages (telegram, report, newspaper, promotion, medals...) until the screen changes. */
async function leaveDebrief(page: Page): Promise<void> {
  for (let i = 0; i < 12 && (await currentScreen(page)) === 'debrief'; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
  }
}

test('quick mission from the Quick Mission screen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expectScreen(page, 'title');
  await page.click('text=Quick Mission');
  await expectScreen(page, 'quick');
  await page.selectOption('select[aria-label="Your aircraft"]', 'sopwith_camel');
  await page.click('text=To the briefing');
  await expectScreen(page, 'briefing');
  await page.click('button:has-text("Take off")');
  await passFlyingSchool(page);

  await waitForFlight(page, 15);
  // The menu layer is hidden while flying.
  await expect(page.locator('.rb-ui')).toBeHidden();
  const hudText = await page.locator('.rb-hud').innerText();
  expect(hudText).toMatch(/SPEED/);
  await page.screenshot({ path: 'test-results/quick-hud.png' });

  // Pause -> Abandon mission.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hud-card');
  expect(await page.evaluate(() => window.__rb2!.session!.paused)).toBe(true);
  await page.click('.hud-card button:has-text("Abandon mission")');
  await expectScreen(page, 'debrief');
  await expect(page.locator('.rb-ui')).toBeVisible();
  await page.screenshot({ path: 'test-results/quick-debrief.png' });
  await leaveDebrief(page);
  await expectScreen(page, 'quick');
  expect(errors).toEqual([]);
});

test('career: enlist in Jasta 11, fly, debrief, persist', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expectScreen(page, 'title');
  await page.click('text=Career');
  await expectScreen(page, 'roster');
  await page.click('.dossier.new');
  await expectScreen(page, 'create-pilot');
  await page.fill('input[aria-label="First name"]', 'Karl');
  await page.fill('input[aria-label="Surname"]', 'Hartmann');
  // Defaults are Germany and 1917-04-01; pin them anyway.
  await page.click('.nations .choice:nth-child(1)');
  await expect(page.locator('.date-readout')).toContainText('1917');
  await page.click('.squadron-list .choice:has-text("Jagdstaffel 11")');
  await page.click('text=Sign & enlist');
  await expectScreen(page, 'hq');
  await expect(page.locator('.stat-grid')).toContainText('Sorties');

  await page.click('text=Proceed to briefing');
  await expectScreen(page, 'briefing');
  await page.screenshot({ path: 'test-results/career-briefing.png' });
  await page.click('button:has-text("Take off")');
  await passFlyingSchool(page);
  await waitForFlight(page, 10);
  await page.screenshot({ path: 'test-results/career-hud.png' });

  // End flight with N and confirm on the HUD card (safe or not, the flight ends).
  await page.keyboard.press('KeyN');
  await page.waitForSelector('.hud-card');
  await page.click('.hud-card button.primary');
  await expectScreen(page, 'debrief');
  await page.screenshot({ path: 'test-results/career-debrief.png' });
  await leaveDebrief(page);
  await expectScreen(page, 'hq');
  const sorties = page.locator('.stat-grid .stat').nth(1).locator('.v');
  await expect(sorties).toHaveText('1');

  // Persists across a reload.
  await page.reload();
  await expectScreen(page, 'title');
  await page.click('text=Career');
  await expectScreen(page, 'roster');
  await expect(page.locator('.rb-screen:not(.leaving)')).toContainText('Hartmann');
  await page.click('.actions button.primary');
  await expectScreen(page, 'hq');
  await expect(page.locator('.stat-grid .stat').nth(1).locator('.v')).toHaveText('1');
  expect(errors).toEqual([]);
});
