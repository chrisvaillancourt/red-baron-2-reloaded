import { expect, test, type Page } from '@playwright/test';

/**
 * Career awards path through the real UI and campaign service. A scripted flight is hard
 * to make score (the wave-5 playtest never reached these screens in play), so the flight
 * launcher is swapped for one that returns a MissionResult with twelve witnessed victories
 * over friendly ground. Everything after that is real: applyMissionResult confirms the
 * claims, promotes, decorates and writes the headline, and the debrief shows the combat
 * report, newspaper, promotion and medal pages before HQ lists the victories.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function expectScreen(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want,
    id,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

test('career: a twelve-victory sortie earns the headline, promotion and a medal', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expectScreen(page, 'title');

  // Stand in for the flight: twelve witnessed kills over our side of the lines (Leutnant to
  // Oberleutnant takes ten confirmed).
  await page.waitForFunction(() => !!window.__rb2?.services);
  await page.evaluate(() => {
    const services = window.__rb2!.services as unknown as { launcher: { fly: (m: unknown) => Promise<unknown> } };
    services.launcher = {
      fly: async (mission) => {
        const m = mission as {
          id: string;
          flights: { role: string; side: string; aircraftId: string; start: { x: number; z: number } }[];
        };
        const me = m.flights.find((f) => f.role === 'player-flight')!;
        const foe = m.flights.find((f) => f.side !== me.side)?.aircraftId ?? 'sopwith_pup';
        const claims = Array.from({ length: 12 }, (_, i) => ({
          time: 120 + i * 30,
          victimAircraftId: foe,
          victimName: 'enemy scout',
          victimSide: me.side === 'central' ? 'allied' : 'central',
          x: me.start.x,
          z: me.start.z,
          witnessed: true,
          shared: false,
        }));
        return {
          missionId: m.id,
          playerFate: 'returned',
          playerOutcome: 'landed-friendly',
          endedByPlayer: false,
          claims,
          objectives: [],
          missionSuccess: true,
          friendlyLosses: [],
          enemyLosses: 12,
          flightTimeS: 1500,
          roundsFired: 900,
          hits: 180,
          wingmanClaims: [],
        };
      },
    };
  });

  await page.click('text=Career');
  await expectScreen(page, 'roster');
  await page.click('.dossier.new');
  await expectScreen(page, 'create-pilot');
  await page.fill('input[aria-label="First name"]', 'Otto');
  await page.fill('input[aria-label="Surname"]', 'Brandt');
  await page.click('.nations .choice:nth-child(1)');
  await page.click('.squadron-list .choice:has-text("Jagdstaffel 11")');
  await page.click('text=Sign & enlist');
  await expectScreen(page, 'hq');

  await page.click('text=Proceed to briefing');
  await expectScreen(page, 'briefing');
  await page.click('button:has-text("Take off")');
  const school = page.locator('.rb-modal:has-text("Flying School") button:has-text("Understood")');
  await expect(school).toBeVisible({ timeout: 5_000 });
  await school.click();
  await expectScreen(page, 'debrief');

  // Walk the debrief, recording each page as it appears.
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const kind = await page.evaluate(() => {
      const s = document.querySelector('.rb-screen:not(.leaving)');
      if (s?.getAttribute('data-screen') !== 'debrief') return null;
      const stage = s.querySelector('.debrief');
      if (stage?.querySelector('.newspaper')) return `newspaper:${stage.querySelector('.headline')?.textContent ?? ''}`;
      if (stage?.querySelector('.report')) return `report:${stage.querySelector('.narrative')?.textContent ?? ''}`;
      const cer = stage?.querySelector('.ceremony');
      if (cer) return `ceremony:${cer.querySelector('h2')?.textContent ?? ''}`;
      return stage?.firstElementChild?.className ?? '?';
    });
    if (kind === null) break;
    seen.push(kind);
    await page.screenshot({ path: `test-results/career-awards-${i}.png` });
    await page.click('.debrief button.primary');
    await page.waitForTimeout(350);
  }
  await expectScreen(page, 'hq');

  const report = seen.find((s) => s.startsWith('report:')) ?? '';
  expect(report).toMatch(/claims? (has|have) been confirmed/);
  expect(seen.some((s) => /^newspaper:NEW ACE: .*BRANDT SCORES FIFTH VICTORY/.test(s))).toBe(true);
  expect(seen).toContain('ceremony:Promotion');
  expect(seen.some((s) => s.startsWith('ceremony:') && s !== 'ceremony:Promotion')).toBe(true);
  // Order: report, newspaper, promotion, then medals.
  const idx = (p: RegExp) => seen.findIndex((s) => p.test(s));
  expect(idx(/^report:/)).toBeLessThan(idx(/^newspaper:/));
  expect(idx(/^newspaper:/)).toBeLessThan(idx(/^ceremony:Promotion$/));

  // The pilot record reflects it.
  const pilot = await page.evaluate(() => {
    const c = window.__rb2!.services.campaign;
    const id = c.listPilots()[0].id;
    const p = c.loadPilot(id)!;
    return { victories: p.victories.filter((v) => v.confirmed).length, medals: p.medals.map((m) => m.medalId), rank: p.rankId, missions: p.missionsFlown };
  });
  expect(pilot.victories).toBeGreaterThanOrEqual(10);
  expect(pilot.rank).toBe('de-oblt');
  expect(pilot.medals.length).toBeGreaterThanOrEqual(1);
  expect(pilot.missions).toBe(1);
  await expect(page.locator('.stat-grid')).toContainText(String(pilot.victories));
  expect(errors).toEqual([]);
});
