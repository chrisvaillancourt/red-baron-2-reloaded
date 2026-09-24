// Drive a full career loop through the UI harness with mock services:
// title -> roster -> create pilot -> HQ -> briefing -> (mock flight) -> debrief -> HQ,
// plus quick mission and options. Keyboard-first to exercise focus navigation.
// Usage: node dev/flow-ui.mjs [baseUrl] [shotDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5291';
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));

const screen = () => page.evaluate(() => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen'));
const expectScreen = async (id) => {
  await page.waitForFunction((want) => document.querySelector('.rb-screen:not(.leaving)')?.getAttribute('data-screen') === want, id, { timeout: 5000 });
  await page.waitForTimeout(350);
};
const snap = async (n) => shots && page.screenshot({ path: `${shots}/flow-${n}.png` });
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);

await page.goto(`${base}/dev/ui.html`);
await expectScreen('title');
// Keyboard: Career is autofocused; press Enter.
await page.keyboard.press('Enter');
await expectScreen('roster');
ok('title -> roster via keyboard');

// New pilot
await page.click('.dossier.new');
await expectScreen('create-pilot');
await page.fill('input[aria-label="First name"]', 'Arthur');
await page.fill('input[aria-label="Surname"]', 'Tennant');
await page.click('.nations .choice:nth-child(2)'); // Britain
await page.evaluate(() => {
  const r = document.querySelector('input[aria-label="Career start date"]');
  r.value = String(Math.round(Number(r.max) * 0.62));
  r.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(400);
await snap('create');
const sqCount = await page.locator('.squadron-list .choice').count();
if (sqCount < 2) throw new Error('no squadrons offered for Britain');
await page.click('.squadron-list .choice:nth-child(2)');
await page.click('text=Sign & enlist');
await expectScreen('hq');
ok(`pilot created (${sqCount - 1} squadrons offered) -> HQ`);
await snap('hq');

// Aircraft picker and tabs
for (let i = 1; i < 6; i++) {
  await page.keyboard.press(']');
  await page.waitForTimeout(120);
}
await page.keyboard.press(']'); // wraps to Orders
await page.waitForTimeout(200);
ok('tabs cycle with ]');

await page.click('text=Proceed to briefing');
await expectScreen('briefing');
await snap('briefing');
ok('briefing shown');

await page.click('text=Take off');
await page.waitForSelector('.rb-hud', { timeout: 5000 });
await page.waitForTimeout(800);
await snap('flight');
// Pause menu opens and resumes
await page.keyboard.press('Escape');
await page.waitForSelector('.hud-card');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
if (await page.locator('.hud-card').count()) throw new Error('pause menu did not close');
ok('pause menu open/close');
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
if (!(await page.locator('.hud-map canvas').count())) throw new Error('map did not open');
await snap('flight-map');
await page.keyboard.press('KeyM');
ok('in-flight map toggles');
await page.keyboard.press('KeyN');
await page.waitForSelector('.hud-card');
await page.click('.hud-card button.primary');
await expectScreen('debrief');
ok('flight ended -> debrief');
await snap('debrief');

// Step through debrief pages with Enter until HQ
for (let i = 0; i < 8 && (await screen()) === 'debrief'; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
}
await expectScreen('hq');
const sorties = await page.locator('.stat .v').nth(1).textContent();
if (sorties !== '1') throw new Error(`expected 1 sortie, got ${sorties}`);
ok('debrief -> HQ, sortie recorded');

// Logbook shows the entry
await page.click('.tab:nth-child(2)');
if (!(await page.locator('.ledger tbody tr').count())) throw new Error('logbook empty');
ok('logbook has entry');

// Options: preset + rebind
await page.click('text=Options');
await expectScreen('options');
await page.click('.presets .seg button:has-text("Authentic")');
await page.click('.tab:has-text("Keys")');
await page.locator('.keycap').first().click();
await page.keyboard.press('KeyI');
await page.waitForTimeout(200);
const cap = await page.locator('.keycap').first().textContent();
if (cap !== 'I') throw new Error(`rebind failed: ${cap}`);
ok('options preset + key rebind');
await page.keyboard.press('Escape');
await expectScreen('hq');
await page.click('text=Main menu');
await expectScreen('title');

// Quick mission
await page.click('text=Quick Mission');
await expectScreen('quick');
await page.selectOption('select[aria-label="Your aircraft"]', 'fokker_dri');
await page.waitForTimeout(200);
const enemy = await page.locator('select[aria-label="Enemy aircraft"]').inputValue();
if (!['sopwith_camel', 'se5a', 'sopwith_triplane', 'spad_xiii', 'nieuport_17', 'sopwith_pup', 'spad_vii', 'bristol_f2b'].includes(enemy)) throw new Error(`enemy not Allied: ${enemy}`);
await page.click('.ace-pick .choice:nth-child(2)');
await page.click('text=To the briefing');
await expectScreen('briefing');
ok(`quick mission (Dr.I vs ${enemy}) -> briefing`);

await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('flow OK');
