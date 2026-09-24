// Walk every menu screen of the REAL app (real campaign data) and screenshot it.
// Uses the dev-only hooks window.__rb2 (services) and window.__rb2ui (UI router).
// Usage: node dev/walk-menus.mjs [baseUrl] [outDir] [width] [height] [only]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5304';
const out = process.argv[3] ?? 'test-results/walk';
const W = Number(process.argv[4] ?? 1280);
const H = Number(process.argv[5] ?? 720);
const only = process.argv[6] ?? '';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});

const tag = `${W}x${H}`;
const want = (name) => !only || name.startsWith(only);
const snap = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name);
};
const screen = () => page.evaluate(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen'));
const show = async (id, params = {}) => {
  await page.evaluate(([id, params]) => window.__rb2ui.show(id, params), [id, params]);
  await page.waitForFunction((want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want, id);
  await page.waitForTimeout(300);
};

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__rb2ui && document.querySelector('.rb-screen'));
if (want('title')) await snap('title');

if (want('static')) {
  for (const id of ['roster', 'quick', 'aces', 'controls', 'credits']) {
    await show(id);
    await snap(`static-${id}`);
  }
  await show('options');
  const tabs = await page.locator('.rb-screen:not(.leaving) .tab').count();
  for (let i = 0; i < tabs; i++) {
    await page.locator('.rb-screen:not(.leaving) .tab').nth(i).click();
    await snap(`static-options-${i}`);
  }
}

if (want('create')) {
  await show('create-pilot');
  const nations = await page.locator('.nations .choice').count();
  for (let i = 0; i < nations; i++) {
    await page.locator('.nations .choice').nth(i).click();
    await snap(`create-nation${i}`);
  }
}

const CAREERS = [
  { key: 'de', firstName: 'Kurt', lastName: 'Wolff', nation: 'germany', startDate: '1916-10-15', squadronId: 'jasta2' },
  { key: 'gb', firstName: 'Arthur', lastName: 'Rhys', nation: 'britain', startDate: '1917-06-10', squadronId: 'rfc56' },
  { key: 'fr', firstName: 'René', lastName: 'Dorme', nation: 'france', startDate: '1917-06-01', squadronId: 'spa3' },
  { key: 'us', firstName: 'Douglas', lastName: 'Campbell', nation: 'usa', startDate: '1918-05-01', squadronId: 'us94' },
];

for (const c of CAREERS) {
  if (!want(`career-${c.key}`)) continue;
  const info = await page.evaluate((c) => {
    const camp = window.__rb2.services.campaign;
    const sq = camp.squadronsFor(c.nation, c.startDate);
    const id = sq.find((s) => s.id === c.squadronId)?.id ?? sq[0]?.id;
    const p = camp.createPilot({ firstName: c.firstName, lastName: c.lastName, nation: c.nation, startDate: c.startDate, squadronId: id, difficulty: 'pilot' });
    camp.savePilot(p);
    return { id: p.id, squadrons: sq.map((s) => s.id), squadronId: p.squadronId };
  }, c);
  console.log(c.key, 'squadrons', info.squadrons.join(','), '-> assigned', info.squadronId);
  await show('hq', { pilotId: info.id, welcome: true });
  await snap(`career-${c.key}-hq-welcome`);
  await show('hq', { pilotId: info.id });
  const tabs = await page.locator('.rb-screen:not(.leaving) .tab').count();
  for (let i = 0; i < tabs; i++) {
    await page.locator('.rb-screen:not(.leaving) .tab').nth(i).click();
    await snap(`career-${c.key}-hq-tab${i}`);
  }
  await page.locator('.rb-screen:not(.leaving) .tab').nth(0).click();
  await page.click('text=Proceed to briefing');
  await page.waitForFunction(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === 'briefing');
  await snap(`career-${c.key}-briefing`);

  // Debrief: a successful sortie with three witnessed claims over own lines, after a record
  // that puts the pilot at a medal/promotion threshold.
  await page.evaluate((pilotId) => {
    const camp = window.__rb2.services.campaign;
    const p = camp.loadPilot(pilotId);
    const m = camp.generateMission(p);
    for (let i = 0; i < 7; i++) {
      p.victories.push({ number: i + 1, date: p.date, victim: 'Enemy scout', location: 'over the lines', confirmed: true });
      p.missionsFlown += 3;
    }
    p.fame = 40;
    const enemy = m.flights.find((f) => f.role === 'enemy');
    const home = m.flights.find((f) => f.role === 'player-flight');
    const claims = [0, 1, 2].map((i) => ({
      time: 300 + i * 60,
      victimAircraftId: enemy?.aircraftId ?? 'balloon',
      victimName: 'Enemy machine',
      victimSide: p.side === 'central' ? 'allied' : 'central',
      x: home.start.x,
      z: home.start.z,
      witnessed: true,
      shared: false,
    }));
    const result = {
      missionId: m.id, playerFate: 'returned', playerOutcome: 'landed-friendly', endedByPlayer: false, claims,
      objectives: m.objectives.map((o) => ({ id: o.id, completed: true })), missionSuccess: true,
      friendlyLosses: [], enemyLosses: 3, flightTimeS: 3300, roundsFired: 640, hits: 96, wingmanClaims: [{ pilotName: 'Wingman', count: 1 }],
    };
    const report = camp.applyMissionResult(p, m, result);
    window.__walk = { report, result, mission: m, pilotId };
  }, info.id);
  await page.evaluate(() => window.__rb2ui.show('debrief', window.__walk));
  for (let i = 0; i < 10 && (await screen()) === 'debrief'; i++) {
    await snap(`career-${c.key}-debrief${i}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  await snap(`career-${c.key}-after`);
}

// Bad endings with real campaign output.
for (const fate of ['wounded', 'captured', 'killed']) {
  if (!want(`fate-${fate}`)) continue;
  await page.evaluate((fate) => {
    const camp = window.__rb2.services.campaign;
    const p = camp.createPilot({ firstName: 'Tom', lastName: `Hazard-${fate}`, nation: 'britain', startDate: '1917-04-05', difficulty: 'pilot' });
    camp.savePilot(p);
    const m = camp.generateMission(p);
    const result = {
      missionId: m.id, playerFate: fate, playerOutcome: fate === 'killed' ? 'shot-down' : fate === 'captured' ? 'landed-enemy' : 'landed-friendly',
      endedByPlayer: false, claims: [], objectives: m.objectives.map((o) => ({ id: o.id, completed: false })), missionSuccess: false,
      friendlyLosses: [{ name: 'Lt. Smith', fate: 'killed' }], enemyLosses: 0, flightTimeS: 1500, roundsFired: 220, hits: 9, wingmanClaims: [],
    };
    const report = camp.applyMissionResult(p, m, result);
    window.__walk = { report, result, mission: m, pilotId: p.id };
  }, fate);
  await page.evaluate(() => window.__rb2ui.show('debrief', window.__walk));
  for (let i = 0; i < 8 && (await screen()) === 'debrief'; i++) {
    await snap(`fate-${fate}-${i}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  await snap(`fate-${fate}-after`);
}

// First take-off: Flying School card, then a short real flight and the quick-mission debrief.
if (want('school')) {
  await page.evaluate(() => localStorage.removeItem('rb2r.flyingSchool.seen.v1'));
  await show('quick');
  await page.click('text=To the briefing');
  await page.waitForFunction(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === 'briefing');
  await snap('school-briefing');
  await page.click('button:has-text("Take off")');
  await page.waitForSelector('.rb-modal:has-text("Flying School")');
  await snap('school-card');
  await page.click('.rb-modal button:has-text("Understood")');
  await page.waitForFunction(() => (window.__rb2?.session?.time ?? 0) > 4, undefined, { timeout: 90_000 });
  await snap('school-flight');
  await page.evaluate(() => window.__rb2.session.abandon());
  await page.waitForFunction(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === 'debrief', undefined, { timeout: 30_000 });
  await snap('school-debrief');
}

// Music cue per screen (reads the engine's current cue; no ears required).
if (want('music')) {
  const cue = () => page.evaluate(() => window.__rb2.services.audio.currentMusic);
  await page.mouse.click(5, 5); // user gesture: unlock audio
  const seenCues = [];
  for (const id of ['title', 'roster', 'quick', 'options', 'aces']) {
    await show(id);
    seenCues.push(`${id}=${await cue()}`);
  }
  const pid = await page.evaluate(() => {
    const camp = window.__rb2.services.campaign;
    const p = camp.createPilot({ firstName: 'Music', lastName: 'Check', nation: 'france', startDate: '1917-05-01', difficulty: 'pilot' });
    camp.savePilot(p);
    return p.id;
  });
  await show('hq', { pilotId: pid });
  seenCues.push(`hq=${await cue()}`);
  await page.click('text=Proceed to briefing');
  await page.waitForTimeout(500);
  seenCues.push(`briefing=${await cue()}`);
  console.log('music cues:', seenCues.join(' '));
}

if (want('roster2')) {
  await show('roster');
  await snap('roster2-filled');
}

console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
await browser.close();
