import { expect, test, type Page } from '@playwright/test';

/**
 * The debrief's flight report (docs/PLAYTEST.md "Human playtests"): fly the default quick
 * mission for a few seconds, abandon, rate it, and copy the report. First with the clipboard
 * refused (the fallback box), then with it granted. Both must be the same valid schema-1 JSON.
 */

async function expectScreen(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want,
    id,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

interface Report {
  kind: string;
  schema: number;
  build: { sha: string; builtAt: string; dev?: boolean };
  pilot: string | null;
  rating: string | null;
  note: string;
  settings: { realism: object; mouseMode: string; graphics: string };
  mission: { flights: { role: string; aircraftId: string }[]; date: string };
  quickOptions: { enemyAircraft: string; enemySkill: string } | null;
  outcome: { aborted: boolean; flightTimeS: number; hitsTaken: number | null };
  enemies: { aircraftId: string }[];
  timeCompression: { realS: number } | null;
  performance: { p50: number; p95: number; frames: number } | null;
}

function checkReport(r: Report): void {
  expect(r.kind).toBe('rb2r-flight-report');
  expect(r.schema).toBe(1);
  expect(r.build.sha).toMatch(/^([0-9a-f]{7,}(-dirty)?|unknown)$/);
  expect(r.build.sha).not.toBe('unknown');
  // The e2e server is the dev server: its SHA is as of server start, and the report says so.
  expect(r.build.dev).toBe(true);
  expect(r.pilot).toBeNull();
  expect(r.rating).toBe('fair');
  expect(r.note).toBe('Headed straight for them.');
  expect(r.settings.mouseMode).toBeTruthy();
  expect(r.quickOptions?.enemyAircraft).toBe('fokker_dvii');
  expect(r.mission.flights.some((f) => f.role === 'player-flight')).toBe(true);
  expect(r.outcome.aborted).toBe(true);
  expect(r.outcome.flightTimeS).toBeGreaterThanOrEqual(8);
  expect(r.outcome.hitsTaken).not.toBeNull();
  expect(r.enemies.length).toBe(2);
  expect(r.timeCompression).not.toBeNull();
  expect(r.performance!.frames).toBeGreaterThan(30);
  expect(r.performance!.p50).toBeGreaterThan(0);
}

test('debrief: rate the flight and copy the flight report', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));

  await page.goto('/');
  await expectScreen(page, 'title');
  await page.click('text=Quick Mission');
  await expectScreen(page, 'quick');
  await page.click('text=To the briefing');
  await expectScreen(page, 'briefing');
  await page.click('button:has-text("Take off")');
  const ok = page.locator('.rb-modal:has-text("Flying School") button:has-text("Understood")');
  await expect(ok).toBeVisible({ timeout: 5_000 });
  await ok.click();
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__rb2?.session?.time ?? 0) >= 8, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__rb2!.session!.abandon());
  await expectScreen(page, 'debrief');

  // Rate it and leave a note.
  const strip = page.locator('.playtest');
  await expect(strip).toBeVisible();
  await strip.locator('button:has-text("Fair")').click();
  await expect(strip.locator('button:has-text("Fair")')).toHaveAttribute('aria-pressed', 'true');
  const noteInput = strip.locator('input[aria-label="Playtest note"]');
  await noteInput.fill('Headed straight for them.');
  // Esc in the note leaves the field, not the debrief (a quick debrief is one page).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen'))).toBe('debrief');
  await expect(noteInput).not.toBeFocused();
  await expect(noteInput).toHaveValue('Headed straight for them.');
  await page.screenshot({ path: 'test-results/flight-report-debrief.png' });

  // Clipboard refused: the report appears in a box to copy by hand.
  await page.evaluate(() => {
    const w = window as unknown as { __realWrite?: typeof navigator.clipboard.writeText };
    w.__realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.click('[data-testid="copy-flight-report"]');
  const box = page.locator('.rb-modal textarea.flight-report-text');
  await expect(box).toBeVisible();
  await page.waitForTimeout(600); // let the modal fade in for the screenshot
  await page.screenshot({ path: 'test-results/flight-report-fallback.png' });
  const fromBox = JSON.parse(await box.inputValue()) as Report;
  checkReport(fromBox);
  await page.click('.rb-modal button:has-text("Done")');
  await expect(box).toBeHidden();

  // Clipboard allowed: the same report lands on the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => {
    const w = window as unknown as { __realWrite?: typeof navigator.clipboard.writeText };
    navigator.clipboard.writeText = w.__realWrite!;
  });
  await page.click('[data-testid="copy-flight-report"]');
  await expect(page.locator('text=Flight report copied')).toBeVisible();
  const fromClipboard = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as Report;
  checkReport(fromClipboard);  expect({ ...fromClipboard, createdAt: '' }).toEqual({ ...fromBox, createdAt: '' });

  expect(errors).toEqual([]);
});
