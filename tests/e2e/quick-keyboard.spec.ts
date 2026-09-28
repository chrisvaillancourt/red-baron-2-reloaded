import { expect, test, type Page } from '@playwright/test';

/**
 * Keyboard-only Quick Mission (PLAYTEST wave 7 #6): each button group is one Tab stop (the
 * chosen button), arrows move within it, and "To the briefing" is a short Tab run away.
 */

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { text: el?.textContent?.trim() ?? '', pressed: el?.getAttribute('aria-pressed') ?? null, tag: el?.tagName ?? '' };
  });

test('Quick Mission: Tab moves between groups, arrows within them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === 'title');
  await page.click('text=Quick Mission');
  await page.waitForFunction(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === 'quick');
  await page.waitForTimeout(400);

  // Tab from the first control to the fly button, noting every stop.
  const stops: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const a = await active(page);
    stops.push(a.text.slice(0, 24));
    // Every group button that takes a Tab stop is its group's chosen one.
    if (a.pressed !== null) expect(a.pressed, `stop ${i}: ${a.text}`).toBe('true');
    if (a.text.startsWith('To the briefing')) break;
  }
  expect(stops.at(-1)).toMatch(/^To the briefing/);
  // Was ~57 before the roving tab stops.
  expect(stops.length, stops.join(' | ')).toBeLessThanOrEqual(16);

  // Back to the Mission group (Dogfight is chosen); ArrowRight moves to Intercept, Enter picks it.
  await page.locator('.rb-screen:not(.leaving) .seg button:has-text("Dogfight")').focus();
  await page.keyboard.press('ArrowRight');
  expect((await active(page)).text).toBe('Intercept');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rb-screen:not(.leaving) .seg button:has-text("Intercept")')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rb-screen:not(.leaving) .seg button:has-text("Intercept")')).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.rb-screen:not(.leaving) .seg button:has-text("Dogfight")')).toHaveAttribute('tabindex', '-1');

  // Picking an ace from the keyboard keeps focus on the list (it is rebuilt on each pick).
  await page.locator('.rb-screen:not(.leaving) .ace-pick button').first().focus();
  await page.keyboard.press('ArrowDown');
  const ace = (await active(page)).text;
  await page.keyboard.press('Enter');
  const after = await active(page);
  expect(after.pressed).toBe('true');
  expect(after.text).toBe(ace);
  expect(errors).toEqual([]);
});
