import type { Browser } from '@playwright/test';
import { expect, test, type Page } from './fixtures';

async function controllerContext(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  // Install before startup, rather than replacing the API after the app chooses an owner.
  await context.addInitScript(() => {
    const pads = [0, 1, 2].map(index => ({ index, id: `menu controller ${index}`, connected: true,
      mapping: index === 0 ? '' : 'standard', axes: [0, 0, 0, 0],
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
  await page.waitForTimeout(120); // Let the neutral frame arm a newly mounted owner.
  await hold(page, [button], true, controller);
  await hold(page, [button], false, controller);
}
const current = (page: Page, id: string) => page.locator(`[data-screen="${id}"]:not(.leaving)`);

test('native range and select adjust and persist through their real settings callbacks', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).click();
    const options = current(page, 'options');
    await options.getByRole('tab', { name: 'Graphics', exact: true }).click();
    const fov = options.getByRole('slider', { name: 'Field of view', exact: true });
    await expect(fov).toBeVisible();
    const before = Number(await fov.inputValue());
    await fov.focus();
    await tap(page, 15);
    await expect(fov).toHaveValue(String(before + 1));
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().fov)).toBe(before + 1);
    await options.getByRole('tab', { name: 'Controls', exact: true }).click();
    const mode = options.locator('select');
    await expect(mode).toHaveValue('mouse-aim');
    await mode.focus();
    await tap(page, 15);
    await expect(mode).toHaveValue('direct-stick');
    await expect(mode).toBeFocused();
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().controls.mouseMode)).toBe('direct-stick');
    await tap(page, 13); // Vertical input leaves the native select to navigate the page.
    await expect(mode).not.toBeFocused();
    await page.reload();
    await expect(current(page, 'title')).toBeVisible();
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().fov)).toBe(before + 1);
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().controls.mouseMode)).toBe('direct-stick');
  } finally { await context.close(); }
});

test('partial enemy-panel redraw keeps the native select focused for subsequent adjustment', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    const launch = page.getByRole('button', { name: /Quick Mission/ });
    await expect(launch).toBeVisible();
    await launch.click();
    const quick = current(page, 'quick');
    const enemy = quick.getByRole('combobox', { name: 'Enemy aircraft', exact: true });
    const player = quick.locator('select[data-autofocus]');
    const playerBefore = await player.inputValue();
    const before = await enemy.inputValue();
    const direction = await enemy.evaluate(select => (select as HTMLSelectElement).selectedIndex < (select as HTMLSelectElement).options.length - 1 ? 15 : 14);
    await enemy.focus();
    await tap(page, direction);
    await expect(enemy).not.toHaveValue(before);
    await expect(enemy).toBeFocused();
    await expect(player).toHaveValue(playerBefore);
    await tap(page, direction === 15 ? 14 : 15);
    await expect(enemy).toHaveValue(before);
    await expect(enemy).toBeFocused();
    await expect(player).toHaveValue(playerBefore);
  } finally { await context.close(); }
});

test('partial preset redraw keeps the Enemy skill range focused and persists repeated steps', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).click();
    const options = current(page, 'options');
    const skill = options.getByRole('slider', { name: 'Enemy skill', exact: true });
    await expect(skill).toBeVisible();
    const before = Number(await skill.inputValue());
    const step = Number(await skill.getAttribute('step'));
    const direction = before + step * 2 <= Number(await skill.getAttribute('max')) ? 1 : -1;
    await skill.focus();
    for (let i = 1; i <= 2; i++) {
      await tap(page, direction > 0 ? 15 : 14);
      await expect(skill).toBeFocused();
      expect(Number(await skill.inputValue())).toBeCloseTo(before + step * direction * i);
      expect(await page.evaluate(() => window.__rb2!.services!.getSettings().realism.enemySkillBias)).toBeCloseTo(before + step * direction * i);
    }
  } finally { await context.close(); }
});

test('same-element tab rebuild discards held A and the rest of an A/B chord', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).click();
    const options = current(page, 'options');
    const root = await options.elementHandle();
    await options.getByRole('tab', { name: 'Graphics', exact: true }).focus();
    await page.waitForTimeout(120);
    await hold(page, [0, 1], true);
    await page.waitForTimeout(650);
    await expect(options).toBeVisible();
    await expect(options.getByRole('tab', { name: 'Graphics', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await root!.evaluate(el => el === document.querySelector('[data-screen="options"]:not(.leaving)'))).toBe(true);
    expect(await options.locator('.tab-panel').evaluate(panel => panel.contains(document.activeElement))).toBe(true);
    await hold(page, [0, 1], false);
    await tap(page, 1);
    await expect(current(page, 'title')).toBeVisible();
    // Menu held alongside A cannot activate the next page's restored focus either.
    await page.getByRole('button', { name: /Options/ }).focus();
    await page.waitForTimeout(120);
    await hold(page, [0, 9], true);
    await page.waitForTimeout(650);
    await expect(current(page, 'options')).toBeVisible();
    await expect(current(page, 'options').getByRole('tab', { name: 'Realism', exact: true })).toHaveAttribute('aria-selected', 'true');
    await hold(page, [0, 9], false);
  } finally { await context.close(); }
});

test('only the pinned standard menu owner acts, including after a lower-index standard pad appears', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).focus();
    await tap(page, 0, 0); // Unsupported mapping is not treated as Xbox.
    await tap(page, 0, 2);
    await expect(current(page, 'title')).toBeVisible();
    await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!, { mapping: 'standard' }));
    await tap(page, 0, 0);
    await expect(current(page, 'title')).toBeVisible();
    await tap(page, 0, 1);
    await expect(current(page, 'options')).toBeVisible();
    await page.evaluate(() => Object.assign(navigator.getGamepads()[1]!, { connected: false }));
    await page.waitForTimeout(120);
    await tap(page, 1, 2);
    await expect(current(page, 'options')).toBeVisible();
    await tap(page, 1, 0);
    await expect(current(page, 'title')).toBeVisible();
  } finally { await context.close(); }
});

test('B is edge-only, live gamepad disable blocks menu actions but not keyboard navigation', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).click();
    const options = current(page, 'options');
    await options.getByRole('tab', { name: 'Controls', exact: true }).click();
    const enabled = options.getByRole('checkbox', { name: 'Gamepad', exact: true });
    await expect(enabled).toBeVisible();
    await enabled.focus();
    await tap(page, 0);
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().controls.gamepadEnabled)).toBe(false);
    await hold(page, [1], true);
    await page.waitForTimeout(650);
    await expect(options).toBeVisible();
    await hold(page, [1], false);
    await page.keyboard.press('Escape');
    await expect(current(page, 'title')).toBeVisible();
    await page.getByRole('button', { name: /Options/ }).click();
    await current(page, 'options').getByRole('tab', { name: 'Controls', exact: true }).click();
    await current(page, 'options').getByRole('checkbox', { name: 'Gamepad', exact: true }).click();
    await page.waitForTimeout(120);
    await hold(page, [1], true);
    await expect(current(page, 'title')).toBeVisible();
    // Change page with the keyboard/mouse while B remains held: no repeat Back.
    await page.getByRole('button', { name: /Options/ }).click();
    await page.waitForTimeout(650);
    await expect(current(page, 'options')).toBeVisible();
    await hold(page, [1], false);
    await tap(page, 1);
    await expect(current(page, 'title')).toBeVisible();
  } finally { await context.close(); }
});

test('keyboard key capture remains available while controller menu navigation is enabled', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Options/ }).click();
    const options = current(page, 'options');
    await options.getByRole('tab', { name: 'Keys', exact: true }).click();
    const fire = options.locator('tr:has(td:text-is("Fire guns")) .keycap').first();
    await expect(fire).toBeVisible();
    await fire.click();
    await page.keyboard.press('KeyF');
    await expect(fire).toHaveText('F');
    expect(await page.evaluate(() => window.__rb2!.services!.getSettings().controls.keyBindings.fire)).toEqual(['KeyF']);
    await page.keyboard.press('Escape');
    await expect(current(page, 'title')).toBeVisible();
  } finally { await context.close(); }
});
