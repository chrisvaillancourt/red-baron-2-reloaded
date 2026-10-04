import { chromium } from '@playwright/test';

// Browser-only automation policy; never change the human app's controller handling.
export const FLIGHT_READY_TIMEOUT_MS = 90_000;

/** One native automation policy; extra flags are fixed requirements of repo tools. */
export function automationLaunchOptions(extraArgs = []) {
  return {
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    args: [
      ...(process.env.E2E_SWIFTSHADER
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']),
      ...extraArgs,
    ],
  };
}

/** Reuse one owned native page for a bounded callback, never a regression server. */
export async function withAutomationPage(run, { viewport = { width: 1280, height: 720 } } = {}) {
  const browser = await chromium.launch(automationLaunchOptions());
  let result;
  let operationFailed = false;
  let operationError;
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await disableGamepads(context);
    const page = await context.newPage();
    result = await run({ browser, context, page });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  try {
    await browser.close();
  } catch (closeError) {
    if (operationFailed) {
      throw new AggregateError([operationError, closeError], 'Automation failed and browser cleanup failed', { cause: operationError });
    }
    throw closeError;
  }
  if (operationFailed) throw operationError;
  return result;
}

/** Install before navigation; covers every page, popup and reload in this context. */
export async function disableGamepads(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] });
  });
}

/** Wait for the real session to render, including cold dev-server flight-chunk compilation. */
export async function waitForFlightReady(page, minFrames = 5) {
  await page.waitForFunction(
    (frames) => (window.__rb2?.session?.frames ?? 0) > frames,
    minFrames,
    { timeout: FLIGHT_READY_TIMEOUT_MS },
  );
}

/** Ready remains paused until a trusted capture or keyboard-mode gesture. */
export async function waitForDefenseReady(page) {
  await page.waitForFunction(
    () => !!window.__rb2Defense?.scene,
    undefined,
    { timeout: FLIGHT_READY_TIMEOUT_MS },
  );
}
