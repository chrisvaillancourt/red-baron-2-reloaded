import { bootApp, expect, test, waitForFlightReady, type Page } from './fixtures';

/**
 * Crew stations in the real browser game (docs/bombers.md): the seat keys, the gunner's view
 * with keyboard aim clamped to the field of fire, the hand-back to the pilot, and the
 * bombsight on a D.H.4 bomb run. Flights are launched through GameServices.launcher, as in
 * missions.spec.ts. Screenshots go to test-results/crew/ for a visual check. The sim (track A)
 * fires a station's guns from the player's station inputs and drops his bombs.
 */

type Win = Window & { __result?: unknown; __host?: HTMLElement };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const BASE = {
  enemySkill: 'regular',
  wingmanSkill: 'regular',
  wingmen: 0,
  enemyCount: 1,
  altitudeM: 2000,
  timeOfDay: 'midday',
  cloudCover: 0.1,
  startPosition: 'head-on',
  enemyAircraft: 'albatros_dv',
};

/**
 * Fly a quick mission as the builder makes it (`playerStation` is the starting seat; `type:
 * 'bombing'` a raid). `runInM` starts the player's flight that far short of its bomb
 * waypoint, on the same heading, so the bombsight has the target in view (the raid itself
 * starts about 10 km out).
 */
async function fly(page: Page, opts: Record<string, unknown>, runInM?: number): Promise<void> {
  await page.evaluate(
    ([o, runIn]) => {
      const s = window.__rb2!.services!;
      const m = s.campaign.buildQuickMission(o as never);
      const flight = m.flights.find((f) => f.members.some((x) => x.isPlayer))!;
      const wp = flight.waypoints.find((w) => w.action === 'bomb');
      if (runIn && wp) {
        const dx = wp.x - flight.start.x;
        const dz = wp.z - flight.start.z;
        const d = Math.hypot(dx, dz);
        flight.start.x = wp.x - (dx / d) * runIn;
        flight.start.z = wp.z - (dz / d) * runIn;
      }
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:1000';
      document.body.appendChild(host);
      (window as Win).__host = host;
      (window as Win).__result = undefined;
      void s.launcher.fly(m, s.getSettings(), host).then((r) => ((window as Win).__result = r));
    },
    [opts, runInM] as const,
  );
  await waitForFlightReady(page);
}

const session = (page: Page) =>
  page.evaluate(() => {
    const s = window.__rb2!.session!;
    const p = s.player!;
    const si = p.stationInputs;
    return {
      station: s.station,
      mode: s.cameraMode,
      controller: p.controller,
      ai: s.aiState(p.id) ?? null,
      aim: si ? [si.aim.x, si.aim.y, si.aim.z] : null,
      throttle: p.controls.throttle,
      bombs: p.bombs ?? null,
      alive: p.outcome === null,
      // Rounds left in the flexible (observer's) guns, drums included.
      flexRounds: p.guns.filter((g) => p.spec.guns[g.mountIndex].mount === 'flexible').reduce((n, g) => n + g.roundsLeft + g.sparesLeft * 97, 0),
    };
  });

const hudText = (page: Page) => page.locator('.rb-hud').innerText();

async function end(page: Page): Promise<void> {
  await page.evaluate(() => window.__rb2!.session!.abandon());
  await page.waitForFunction(() => (window as Win).__result !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => (window as Win).__host?.remove());
}

test('Bristol: take the observer seat, aim within the arcs, hand back to the pilot', async ({ page }) => {
  const errors = collectErrors(page);
  await bootApp(page);
  await fly(page, { ...BASE, type: 'dogfight', playerAircraft: 'bristol_f2b' });
  await page.waitForFunction(() => window.__rb2!.session!.time > 1, undefined, { timeout: 30_000 });
  expect((await session(page)).station).toBe('pilot');

  await page.keyboard.press('KeyC');
  await page.waitForFunction(() => window.__rb2!.session!.station === 'observer');
  let s = await session(page);
  expect(s).toMatchObject({ station: 'observer', mode: 'gunner', controller: 'player', alive: true });
  expect(s.ai).not.toBeNull(); // an AI pilot flies
  expect(s.aim).not.toBeNull();
  expect(await hudText(page)).toContain('OBSERVER 2/2');

  // Keyboard aim: the gun swings, and the view with it.
  const aim0 = s.aim!;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  s = await session(page);
  const moved = Math.acos(Math.min(1, aim0[0] * s.aim![0] + aim0[1] * s.aim![1] + aim0[2] * s.aim![2]));
  expect(moved).toBeGreaterThan(0.2);
  await page.waitForTimeout(600); // let the seat message and hint settle
  await page.screenshot({ path: 'test-results/crew/gunner.png' });

  // Space fires the observer's Lewis.
  const rounds0 = s.flexRounds;
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/crew/gunner-firing.png' });
  await page.keyboard.up('Space');
  expect((await session(page)).flexRounds).toBeLessThan(rounds0);

  // Hold the gun down past the beam box's floor: it stops at the edge, drawn red.
  await page.keyboard.down('ArrowUp'); // stick forward: gun down
  await page.waitForTimeout(2500);
  await expect(page.locator('.hud-crew .arc.limited')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/crew/gunner-limit.png' });
  await page.keyboard.up('ArrowUp');

  // F: back to the controls, no AI, no station inputs, the throttle where the AI left it.
  // The sim is frozen across the switch so the AI can't move the throttle in between.
  await page.evaluate(() => window.__rb2!.session!.freeze(true));
  const aiThrottle = (await session(page)).throttle;
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__rb2!.session!.station === 'pilot');
  await page.evaluate(() => window.__rb2!.session!.freeze(false));
  await page.waitForTimeout(300);
  s = await session(page);
  expect(s).toMatchObject({ station: 'pilot', mode: 'cockpit', ai: null, aim: null });
  expect(Math.abs(s.throttle - aiThrottle)).toBeLessThan(0.01);
  expect(await hudText(page)).toContain('PILOT 1/2');

  // V cycles backwards; F1 at a gun is the gunner's view.
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__rb2!.session!.station === 'observer');
  await page.keyboard.press('F2');
  await page.waitForFunction(() => window.__rb2!.session!.cameraMode === 'chase');
  await page.keyboard.press('F1');
  await page.waitForFunction(() => window.__rb2!.session!.cameraMode === 'gunner');
  await end(page);
  expect(errors).toEqual([]);
});

test('a mission can start the player at the gun', async ({ page }) => {
  const errors = collectErrors(page);
  await bootApp(page);
  await fly(page, { ...BASE, type: 'dogfight', playerAircraft: 'bristol_f2b', playerStation: 'observer' });
  const s = await session(page);
  expect(s).toMatchObject({ station: 'observer', mode: 'gunner' });
  await end(page);
  expect(errors).toEqual([]);
});

test('D.H.4 bomb run: F6 takes the observer to the bombsight', async ({ page }) => {
  const errors = collectErrors(page);
  await bootApp(page);
  await fly(page, { ...BASE, type: 'bombing', playerAircraft: 'dh4' }, 3500);
  await page.waitForFunction(() => window.__rb2!.session!.time > 1, undefined, { timeout: 30_000 });
  let s = await session(page);
  expect(s.bombs).toEqual([4]);
  expect(await hudText(page)).toContain('BOMBS 4/4');

  // R in the pilot's seat: the observer aims.
  await page.keyboard.press('KeyR');
  await expect(page.locator('.hud-messages')).toContainText(/observer aims the bombs/i);

  await page.keyboard.press('F6');
  await page.waitForFunction(() => window.__rb2!.session!.cameraMode === 'bombsight');
  s = await session(page);
  expect(s).toMatchObject({ station: 'observer', mode: 'bombsight' });
  await expect(page.locator('.hud-cue')).toBeVisible();
  await expect(page.locator('.hud-cue')).toHaveText(/RUN-IN · \d+ s/);
  await expect(page.locator('.hud-crew .wire')).toBeVisible();
  await expect(page.locator('.hud-crew .impact')).toBeVisible();
  await expect(page.locator('.hud-crew .target')).toBeVisible(); // pinned to the edge while far up the track
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/crew/bombsight.png' });

  // R releases one bomb per press: holding it drops only the one.
  await page.keyboard.down('KeyR');
  await page.waitForFunction(() => window.__rb2!.session!.player!.bombs![0] === 3);
  await page.waitForTimeout(500);
  expect((await session(page)).bombs).toEqual([3]);
  await page.keyboard.up('KeyR');
  await page.waitForTimeout(300); // a frame sees the key up: the flag goes false
  await page.keyboard.press('KeyR'); // a tap quicker than a frame still releases
  await page.waitForFunction(() => window.__rb2!.session!.player!.bombs![0] === 2);
  await expect(page.locator('.rb-hud')).toContainText('BOMBS 2/4');

  // F6 again: back to his gun.
  await page.keyboard.press('F6');
  await page.waitForFunction(() => window.__rb2!.session!.cameraMode === 'gunner');
  await end(page);
  expect(errors).toEqual([]);
});
