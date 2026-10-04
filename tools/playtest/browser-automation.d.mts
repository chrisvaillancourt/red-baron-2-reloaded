import type { BrowserContext, Page } from '@playwright/test';

export const FLIGHT_READY_TIMEOUT_MS: 90_000;
export function disableGamepads(context: BrowserContext): Promise<void>;
export function waitForFlightReady(page: Page, minFrames?: number): Promise<void>;
