// Browser-only automation policy; never change the human app's controller handling.
export const FLIGHT_READY_TIMEOUT_MS = 90_000;

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
