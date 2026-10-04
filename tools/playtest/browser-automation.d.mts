import type { Browser, BrowserContext, LaunchOptions, Page } from '@playwright/test';

export const FLIGHT_READY_TIMEOUT_MS: 90_000;
export function automationLaunchOptions(extraArgs?: readonly string[]): LaunchOptions;
export function withAutomationPage<T>(
  run: (session: { browser: Browser; context: BrowserContext; page: Page }) => Promise<T>,
  options?: { viewport?: { width: number; height: number } },
): Promise<T>;
export function disableGamepads(context: BrowserContext): Promise<void>;
export function waitForFlightReady(page: Page, minFrames?: number): Promise<void>;
export function waitForDefenseReady(page: Page): Promise<void>;
