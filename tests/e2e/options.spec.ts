import { expect, test, type Page } from '@playwright/test';

/**
 * Options through the real UI: keyboard-only menu navigation, a key rebind and a graphics
 * change survive a reload, and Esc backs out of every title-menu screen.
 */

async function screenId(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen'));
}

async function expectScreen(page: Page, id: string): Promise<void> {
  await page.waitForFunction((want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want, id, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

test('options persist, keys rebind, and Esc backs out of every menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expectScreen(page, 'title');

  // Keyboard only: Options is the fourth entry on the title menu.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expectScreen(page, 'options');

  // ] moves to the next tab (Graphics); pick Low.
  await page.keyboard.press('BracketRight');
  await page.click('.rb-screen:not(.leaving) button:has-text("Low")');

  // Rebind Fire to F.
  await page.click('.rb-screen:not(.leaving) .tab:has-text("Keys")');
  const fire = page.locator('tr:has(td:text-is("Fire guns")) .keycap').first();
  await expect(fire).toHaveText('Space');
  await fire.click();
  await expect(fire).toHaveText('Press a key…');
  await page.keyboard.press('KeyF');
  await expect(page.locator('tr:has(td:text-is("Fire guns")) .keycap').first()).toHaveText('F');

  await page.keyboard.press('Escape');
  await expectScreen(page, 'title');
  await page.reload();
  await expectScreen(page, 'title');
  const s = await page.evaluate(() => window.__rb2!.services!.getSettings());
  expect(s.graphics).toBe('low');
  expect(s.controls.keyBindings.fire).toEqual(['KeyF']);

  const menu: [string, string][] = [
    ['Career', 'roster'],
    ['Quick Mission', 'quick'],
    ['Hall of Fame', 'aces'],
    ['Options', 'options'],
    ['Flying Manual', 'controls'],
    ['Credits', 'credits'],
  ];
  for (const [label, id] of menu) {
    await page.click(`.rb-screen:not(.leaving) >> text=${label}`);
    await expectScreen(page, id);
    await page.keyboard.press('Escape');
    await expectScreen(page, 'title');
  }
  expect(await screenId(page)).toBe('title');
  expect(errors).toEqual([]);
});
