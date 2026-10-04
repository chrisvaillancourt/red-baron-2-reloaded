import type { Page } from './fixtures';
import { bootApp, expect, test } from './fixtures';
import { QUICK_DEFAULTS } from '../../src/data/quickDefaults';

async function openDefense(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Airfield Defense/ }).click();
  await page.locator('[data-screen="defense-briefing"] button').filter({ hasText: 'Man the guns' }).click();
  await page.waitForFunction(() => !!window.__rb2Defense?.scene, undefined, { timeout: 90_000 });
  await page.locator('.defense-overlay button').filter({ hasText: 'Return to the guns' }).click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('defense-canvas') && !window.__rb2Defense?.paused);
}

test('mouse chords release fire independently; pause releases capture and freezes combat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await bootApp(page);
  await openDefense(page);
  const capacity = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.capacity);
  await page.mouse.down({ button: 'right' });
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBeLessThan(capacity);
  await page.mouse.up({ button: 'left' });
  const ammo = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBe(ammo);
  const fov = await page.evaluate(() => window.__rb2Defense!.scene!.camera.fov);
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__rb2Defense!.scene!.camera.fov)).toBeGreaterThan(fov);

  await page.keyboard.down('Space');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__rb2Defense!.paused && !document.pointerLockElement);
  const pausedTime = await page.evaluate(() => window.__rb2Defense!.state.time);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(pausedTime);
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Return to the guns' }).click();
  await page.waitForFunction(() => !window.__rb2Defense!.paused);
  const resumedAmmo = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBe(resumedAmmo);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a defense report and exact replay leave an existing career unchanged', async ({ page }) => {
  await bootApp(page);
  const pilot = await page.evaluate(() => {
    const p = window.__rb2!.services!.campaign.createPilot({ firstName: 'Test', lastName: 'Gunner', nation: 'britain', startDate: '1917-09-01', difficulty: 'pilot', postingSeed: 17 });
    return { id: p.id, snapshot: JSON.stringify(p) };
  });
  await openDefense(page);
  const options = await page.evaluate(() => ({ ...window.__rb2Defense!.state.options }));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  const report = page.locator('[data-screen="defense-report"]:not(.leaving)');
  await expect(report).toBeVisible();
  expect(await page.evaluate((id) => JSON.stringify(window.__rb2!.services!.campaign.loadPilot(id)), pilot.id)).toBe(pilot.snapshot);
  expect(await page.evaluate(() => window.__rb2Defense)).toBeUndefined();
  await report.getByRole('button', { name: /Replay same attack/i }).click();
  await page.waitForFunction(() => !!window.__rb2Defense?.scene, undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => ({ ...window.__rb2Defense!.state.options }))).toEqual(options);
  await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  await expect(report).toBeVisible();
  expect(await page.evaluate((id) => JSON.stringify(window.__rb2!.services!.campaign.loadPilot(id)), pilot.id)).toBe(pilot.snapshot);
  await report.locator('[data-action="defense-main-menu"]').click();
  await expect(page.locator('[data-screen="title"]:not(.leaving)')).toBeVisible();
});

test('a flight service request cannot take input or rendering from an active battery', async ({ page }) => {
  await bootApp(page);
  await openDefense(page);
  const attempt = await page.evaluate(async (options) => {
    const services = window.__rb2!.services!;
    const host = document.createElement('div');
    document.body.append(host);
    try {
      return await Promise.race([
        services.launcher.fly(services.campaign.buildQuickMission(options), services.getSettings(), host)
          .then(() => ({ rejected: false }), () => ({ rejected: true })),
        new Promise<{ rejected: boolean }>((resolve) => setTimeout(() => resolve({ rejected: false }), 3000)),
      ]);
    } finally {
      host.remove();
    }
  }, QUICK_DEFAULTS);
  expect(attempt.rejected).toBe(true);
  const time = await page.evaluate(() => window.__rb2Defense!.state.time);
  await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.time)).toBeGreaterThan(time);
  expect(await page.evaluate(() => document.pointerLockElement?.classList.contains('defense-canvas'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
});

test('shared fire and pause bindings work even when fire also selects a gun', async ({ page }) => {
  await bootApp(page);
  await page.evaluate(() => {
    const services = window.__rb2!.services!;
    const settings = structuredClone(services.getSettings());
    settings.controls.keyBindings.fire = ['Digit1'];
    settings.controls.keyBindings.pause = ['KeyP'];
    services.saveSettings(settings);
  });
  await openDefense(page);
  const capacity = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.capacity);
  await page.keyboard.down('1');
  await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBeLessThan(capacity);
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__rb2Defense!.paused && !document.pointerLockElement);
  const time = await page.evaluate(() => window.__rb2Defense!.state.time);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(time);
  await page.keyboard.up('1');
  await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
});
