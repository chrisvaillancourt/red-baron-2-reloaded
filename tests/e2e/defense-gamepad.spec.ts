import type { Browser } from '@playwright/test';
import { expect, test, waitForDefenseReady, type Page } from './fixtures';

async function button(page: Page, index: number, value: number, controller = 0): Promise<void> {
  await page.evaluate(({ index, value, controller }) => Object.assign(navigator.getGamepads()[controller]!.buttons[index], { pressed: value > 0.4, value }), { index, value, controller });
  await page.waitForTimeout(100);
}
async function tap(page: Page, index: number, controller = 0): Promise<void> {
  await button(page, index, 1, controller);
  await button(page, index, 0, controller);
}

async function controllerContext(browser: Browser, baseURL: string | undefined, connected = true) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(connected => {
    const pads = [0, 1].map(index => ({ index, id: `test Xbox ${index}`, connected, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads });
  }, connected);
  return context;
}

async function reachResupply(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Airfield Defense/ }).click();
  await page.locator('[data-screen="defense-briefing"]:not(.leaving)').getByRole('button', { name: 'Man the guns', exact: true }).click();
  await waitForDefenseReady(page);
  await page.getByRole('button', { name: 'Use controller', exact: true }).click();
  // Consume scheduled groups, then let the actual model open resupply.
  await page.evaluate(() => { Object.assign(window.__rb2Defense!.state, { raidTime: 1e6 }); });
  await page.waitForFunction(() => window.__rb2Defense!.state.threats.length > 0);
  await page.evaluate(() => {
    const state = window.__rb2Defense!.state;
    for (const objects of [state.threats, state.bombs, state.projectiles]) Object.assign(objects, { length: 0 });
  });
  await expect(page.getByRole('heading', { name: 'Raid 1 survived', exact: true })).toBeVisible();
  await page.waitForTimeout(100);
}

async function reconnectHolding(page: Page, buttons: number[]): Promise<void> {
  await page.evaluate(buttons => {
    const pad = navigator.getGamepads()[0]!;
    Object.assign(pad, { connected: false });
    for (const index of buttons) Object.assign(pad.buttons[index], { pressed: true, value: 1 });
    const disconnected = new Event('gamepaddisconnected');
    Object.defineProperty(disconnected, 'gamepad', { value: pad });
    window.dispatchEvent(disconnected);
    Object.assign(pad, { connected: true }); // The sampled identity never changes.
  }, buttons);
}

test('Xbox battery ownership survives launch, station changes, pause, reconnect and report handback', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).focus();
    await tap(page, 0);
    const briefing = page.locator('[data-screen="defense-briefing"]:not(.leaving)');
    await expect(briefing).toBeVisible();
    await briefing.getByRole('button', { name: 'Man the guns', exact: true }).focus();
    await button(page, 0, 1);
    await waitForDefenseReady(page);
    await page.waitForTimeout(500); // A stays held across the entire loading/overlay handoff.
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await button(page, 0, 0);
    await expect(page.getByRole('button', { name: 'Use controller', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use controller', exact: true }).focus();
    await tap(page, 0);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    const capacity = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.capacity);
    await button(page, 7, 0.6);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBeLessThan(capacity);
    const disconnectedState = await page.evaluate(() => {
      const pad = navigator.getGamepads()[0]!;
      Object.assign(pad, { connected: false });
      const disconnected = new Event('gamepaddisconnected');
      Object.defineProperty(disconnected, 'gamepad', { value: pad });
      window.dispatchEvent(disconnected);
      const state = { paused: window.__rb2Defense!.paused, ammo: window.__rb2Defense!.state.weapons.mg.ammo };
      Object.assign(pad, { connected: true });
      const connected = new Event('gamepadconnected');
      Object.defineProperty(connected, 'gamepad', { value: pad });
      window.dispatchEvent(connected);
      // A fresh Menu press after connection, before either navigation/game RAF.
      Object.assign(pad.buttons[9], { pressed: true, value: 1 });
      return state;
    });
    expect(disconnectedState.paused).toBe(true);
    const disconnectedAmmo = disconnectedState.ammo;
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await button(page, 9, 0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBe(disconnectedAmmo);
    await button(page, 7, 0);
    await button(page, 7, 0.6);
    await tap(page, 5); // Switching while RT remains held must not fire the next station.
    const cannon = await page.evaluate(() => window.__rb2Defense!.state.weapons.cannon.capacity);
    expect(await page.evaluate(() => window.__rb2Defense!.state.selected)).toBe('cannon');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.cannon.ammo)).toBe(cannon);
    await button(page, 7, 0);
    await button(page, 7, 0.6);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.weapons.cannon.ammo)).toBeLessThan(cannon);
    await tap(page, 9);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    const time = await page.evaluate(() => window.__rb2Defense!.state.time);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(time);
    await tap(page, 1, 1); // An idle second controller cannot close the owner's pause.
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await button(page, 7, 0);
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await button(page, 7, 0.6, 1);
    await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!, { connected: false }));
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    const ammo = await page.evaluate(() => window.__rb2Defense!.state.weapons.cannon.ammo);
    await button(page, 7, 0, 1);
    await tap(page, 9, 1);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.cannon.ammo)).toBe(ammo);
    await tap(page, 9, 1);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).focus();
    await button(page, 0, 1, 1);
    await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
    await page.waitForTimeout(600); // Held A must not activate the report's autofocus Replay.
    expect(await page.evaluate(() => window.__rb2Defense)).toBeUndefined();
    await button(page, 0, 0, 1);
    await tap(page, 0, 1);
    await waitForDefenseReady(page);
    expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBe(capacity);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
  } finally {
    await context.close();
  }
});

test('resupply purchases and A/B handoff chords cannot activate the next overlay', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await reachResupply(page);
    await page.getByRole('button', { name: /Gun power · level 0/ }).focus();
    const clock = await page.evaluate(() => window.__rb2Defense!.state.time);
    await reconnectHolding(page, [0]);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__rb2Defense!.state.upgrades.power)).toBe(0);
    expect(await page.evaluate(() => window.__rb2Defense!.state.phase)).toBe('resupply');
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await button(page, 0, 0);
    await button(page, 0, 1);
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__rb2Defense!.state.upgrades.power)).toBe(1);
    expect(await page.evaluate(() => window.__rb2Defense!.state.phase)).toBe('resupply');
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await button(page, 0, 0);
    await page.getByRole('button', { name: 'Next raid', exact: true }).focus();
    await page.evaluate(() => {
      for (const index of [0, 1]) Object.assign(navigator.getGamepads()[0]!.buttons[index], { pressed: true, value: 1 });
    });
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__rb2Defense!.state.raid)).toBe(2);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await button(page, 0, 0);
    await button(page, 1, 0);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
    await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('held A during loading focuses cancellation but cannot auto-abandon', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  const release: (() => void)[] = [];
  try {
    const page = await context.newPage();
    await page.route('**/models/*.glb', route => new Promise<void>(resolve => {
      release.push(() => { void route.abort().finally(resolve); });
    }));
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).click();
    await page.locator('[data-screen="defense-briefing"]:not(.leaving)').getByRole('button', { name: 'Man the guns', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preparing the airfield' })).toBeVisible();
    await page.waitForTimeout(100);
    await button(page, 0, 1);
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => !!window.__rb2Defense)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Preparing the airfield' })).toBeVisible();
    await button(page, 0, 0);
    await tap(page, 0); // A fresh activation of focused Abandon is still available.
    await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
  } finally {
    for (const finish of release) finish();
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
  }
});

test('controller activation owns interrupted and fatal error cards instead of the obscured menu', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).waitFor();
    await page.evaluate(async () => {
      const moduleUrl = '/src/game/errorOverlay.ts';
      (await import(moduleUrl)).showFlightInterrupted(new Error('controlled setup interruption'), 'setup');
    });
    await page.waitForTimeout(100);
    await tap(page, 0);
    await expect(page.locator('#rb-flight-error')).toBeHidden();
    await expect(page.locator('[data-screen="title"]:not(.leaving)')).toBeVisible();
    await page.evaluate(async () => {
      const moduleUrl = '/src/game/errorOverlay.ts';
      (await import(moduleUrl)).showFatalError(new Error('controlled recovery probe'));
    });
    await page.waitForTimeout(100);
    await tap(page, 0);
    await expect(page.locator('#rb-fatal')).toBeHidden();
    await expect(page.locator('[data-screen="title"]:not(.leaving)')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('late controller discovery focuses pointerless resume and requires a fresh activation', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL, false);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).click();
    await page.locator('[data-screen="defense-briefing"]:not(.leaving)').getByRole('button', { name: 'Man the guns', exact: true }).click();
    await waitForDefenseReady(page);
    const resume = page.getByRole('button', { name: 'Use controller', exact: true });
    await expect(resume).toBeDisabled();
    await page.evaluate(() => {
      const pad = navigator.getGamepads()[0]!;
      Object.assign(pad, { connected: true });
      Object.assign(pad.buttons[0], { pressed: true, value: 1 });
      const connected = new Event('gamepadconnected');
      Object.defineProperty(connected, 'gamepad', { value: pad });
      window.dispatchEvent(connected);
    });
    await page.waitForTimeout(500);
    await expect(resume).toBeFocused();
    await expect(resume).toHaveCSS('outline-style', 'solid'); // Mouse-started sessions still expose controller focus.
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await button(page, 0, 0);
    await tap(page, 0);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await tap(page, 15);
    await expect(page.locator('.defense-overlay button:focus')).toHaveCSS('outline-style', 'solid');
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await page.evaluate(async () => {
      const moduleUrl = '/src/game/errorOverlay.ts';
      (await import(moduleUrl)).showFlightInterrupted(new Error('foreground battery interruption'), 'flight');
    });
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    const clock = await page.evaluate(() => window.__rb2Defense!.state.time);
    const dismiss = page.locator('#rb-flight-error').getByRole('button', { name: 'Return to menu', exact: true });
    await expect(dismiss).toBeFocused();
    await expect(dismiss).toHaveCSS('outline-style', 'solid');
    await tap(page, 9);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await tap(page, 0);
    await expect(page.locator('#rb-flight-error')).toBeHidden();
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
    await expect(page.locator('[data-screen="defense-report"]:not(.leaving)')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('same-slot reconnect cannot transfer held A or Menu into an existing pause', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).click();
    await page.locator('[data-screen="defense-briefing"]:not(.leaving)').getByRole('button', { name: 'Man the guns', exact: true }).click();
    await waitForDefenseReady(page);
    await page.getByRole('button', { name: 'Use controller', exact: true }).click();
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    const clock = await page.evaluate(() => window.__rb2Defense!.state.time);
    await page.getByRole('button', { name: 'Use controller', exact: true }).focus();
    await reconnectHolding(page, [0]);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await button(page, 0, 0);
    await tap(page, 0);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await reconnectHolding(page, [9]);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await button(page, 9, 0);
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await tap(page, 9);
    await page.evaluate(() => {
      const pad = navigator.getGamepads()[0]!;
      for (const index of [0, 9]) Object.assign(pad.buttons[index], { pressed: true, value: 1 });
      const connected = new Event('gamepadconnected');
      Object.defineProperty(connected, 'gamepad', { value: pad });
      window.dispatchEvent(connected);
    });
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    await button(page, 0, 0);
    await button(page, 9, 0);
    await tap(page, 9);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await tap(page, 9);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  } finally {
    await context.close();
  }
});

test('resupply A/Menu chord advances the raid but cannot resume its new overlay', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await reachResupply(page);
    const clock = await page.evaluate(() => window.__rb2Defense!.state.time);
    await page.getByRole('button', { name: 'Next raid', exact: true }).focus();
    await page.evaluate(() => {
      for (const index of [0, 9]) Object.assign(navigator.getGamepads()[0]!.buttons[index], { pressed: true, value: 1 });
    });
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__rb2Defense!.state.raid)).toBe(2);
    expect(await page.evaluate(() => window.__rb2Defense!.paused)).toBe(true);
    expect(await page.evaluate(() => window.__rb2Defense!.state.time)).toBe(clock);
    await button(page, 0, 0);
    await button(page, 9, 0);
    await tap(page, 9); // A fresh Menu edge still resumes after release.
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await tap(page, 9);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  } finally {
    await context.close();
  }
});

test('fresh Menu after initial connection works before the next RAF with held fire gated', async ({ browser, baseURL }) => {
  const context = await controllerContext(browser, baseURL, false);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Airfield Defense/ }).click();
    await page.locator('[data-screen="defense-briefing"]:not(.leaving)').getByRole('button', { name: 'Man the guns', exact: true }).click();
    await waitForDefenseReady(page);
    const capacity = await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.capacity);
    await page.evaluate(() => {
      const pad = navigator.getGamepads()[0]!;
      Object.assign(pad, { connected: true });
      Object.assign(pad.buttons[7], { pressed: true, value: 1 });
      const connected = new Event('gamepadconnected');
      Object.defineProperty(connected, 'gamepad', { value: pad });
      window.dispatchEvent(connected);
      Object.assign(pad.buttons[9], { pressed: true, value: 1 });
    });
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.paused)).toBe(false);
    await button(page, 9, 0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBe(capacity);
    await button(page, 7, 0);
    await button(page, 7, 1);
    await expect.poll(() => page.evaluate(() => window.__rb2Defense!.state.weapons.mg.ammo)).toBeLessThan(capacity);
    await button(page, 7, 0);
    await tap(page, 9);
    await page.getByRole('button', { name: 'Abandon defense', exact: true }).click();
  } finally {
    await context.close();
  }
});
