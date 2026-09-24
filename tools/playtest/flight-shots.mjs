// Playtest screenshot harness: launches a quick mission in the running dev
// server, flies a few seconds, then captures each requested view.
//
//   node tools/playtest/flight-shots.mjs --port 5301 --aircraft sopwith_camel \
//        --out /tmp/shots --views cockpit,chase,padlock --fly 4
//
// Extra: --enemy albatros_dv --count 2 --alt 1500 --start head-on --eval "<js>"
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const port = args.port ?? '5301';
const out = args.out ?? 'test-results/playtest';
const aircraft = args.aircraft ?? 'sopwith_camel';
const views = (args.views ?? 'cockpit,chase').split(',');
const flySeconds = Number(args.fly ?? 4);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1280), height: Number(args.h ?? 720) } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__rb2?.services);
await page.evaluate(
  ({ aircraft, enemy, count, alt, start, wingmen, tod, realism }) => {
    const s = window.__rb2.services;
    const settings = s.getSettings();
    if (realism) settings.realism.flightModel = realism;
    const mission = s.campaign.buildQuickMission({
      playerAircraft: aircraft,
      enemyAircraft: enemy,
      enemyCount: count,
      wingmen,
      enemySkill: 'regular',
      wingmanSkill: 'regular',
      altitudeM: alt,
      startPosition: start,
      timeOfDay: tod,
      cloudCover: 0.3,
      type: 'dogfight',
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    window.__done = null;
    s.launcher.fly(mission, settings, host).then((r) => (window.__done = r));
  },
  {
    aircraft,
    enemy: args.enemy ?? (aircraft.startsWith('fokker') || aircraft.startsWith('albatros') || aircraft.startsWith('pfalz') ? 'sopwith_camel' : 'albatros_dv'),
    count: Number(args.count ?? 1),
    alt: Number(args.alt ?? 1500),
    start: args.start ?? 'head-on',
    wingmen: Number(args.wingmen ?? 0),
    tod: args.tod ?? 'morning',
    realism: args.realism,
  },
);
await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
if (args.eval) await page.evaluate(args.eval);
await page.waitForTimeout(flySeconds * 1000);
if (args.freeze !== 'no') await page.evaluate(() => window.__rb2.session.freeze(true));
const cmd = { cockpit: 'viewCockpit', chase: 'viewChase', padlock: 'viewPadlock', flyby: 'viewFlyby', target: 'viewTarget' };
for (const v of views) {
  const [name, extra] = v.split(':');
  await page.evaluate(({ c }) => window.__rb2.session.command(c), { c: cmd[name] ?? name });
  if (extra) await page.evaluate(extra);
  await page.waitForTimeout(Number(args.settle ?? 700));
  await page.screenshot({ path: `${out}/${aircraft}-${name}.png` });
}
const state = await page.evaluate(() => {
  const p = window.__rb2.session.player;
  return p && { alt: Math.round(p.state.altitude), ias: Math.round(p.state.airspeed * 3.6), rpm: Math.round(p.state.engineRpm), g: +p.state.gLoad.toFixed(2), outcome: p.outcome };
});
console.log(JSON.stringify({ aircraft, state, errors: errors.slice(0, 5) }));
await browser.close();
