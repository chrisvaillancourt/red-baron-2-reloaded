import { expect, test as base, type Page } from '@playwright/test';
import { disableGamepads } from '../../tools/playtest/browser-automation.mjs';

export { expect, type CDPSession, type Page } from '@playwright/test';
export { FLIGHT_READY_TIMEOUT_MS, waitForFlightReady } from '../../tools/playtest/browser-automation.mjs';

// Override the context, not just the initial page: new pages and reloads must also
// see no physical controller before any app code reads its buttons or axes (F-60).
export const test = base.extend({
  context: async ({ context }, use) => {
    await disableGamepads(context);
    await use(context);
  },
});

/** Boot the app for service-launched flights without depending on the menu layout. */
export async function bootApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
}

/** First take-off on a fresh profile shows the Flying School primer. */
export async function passFlyingSchool(page: Page): Promise<void> {
  const ok = page.locator('.rb-modal:has-text("Flying School") button:has-text("Understood")');
  await expect(ok).toBeVisible({ timeout: 5_000 });
  await ok.click();
}
