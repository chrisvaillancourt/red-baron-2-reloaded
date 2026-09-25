// Mouse-aim cockpit-view check (PLAYTEST #4): fly a quick mission, then sweep
// the aim point off the nose with synthetic mouse deltas (hard turn, then a
// hard pull) and capture the cockpit view mid-manoeuvre with the head angles.
//
//   node tools/playtest/aim-turn-shots.mjs --port 5331 --out test-results/aimturn --label after
//
// Extra: --aircraft sopwith_camel --rate 70 (deg/s the aim sweeps) --seconds 2.5
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const port = args.port ?? '5331';
const out = args.out ?? 'test-results/aimturn';
const label = args.label ?? 'shot';
const aircraft = args.aircraft ?? 'sopwith_camel';
const rate = Number(args.rate ?? 70);
const seconds = Number(args.seconds ?? 2.5);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__rb2?.services);
await page.evaluate((aircraft) => {
  const s = window.__rb2.services;
  const mission = s.campaign.buildQuickMission({
    playerAircraft: aircraft,
    enemyAircraft: 'albatros_dv',
    enemyCount: 1,
    wingmen: 0,
    enemySkill: 'novice',
    wingmanSkill: 'regular',
    altitudeM: 1500,
    startPosition: 'head-on',
    timeOfDay: 'morning',
    cloudCover: 0.3,
    type: 'dogfight',
  });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:50';
  document.body.appendChild(host);
  s.launcher.fly(mission, s.getSettings(), host);
}, aircraft);
await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
await page.waitForTimeout(2000);

const sens = await page.evaluate(() => window.__rb2.services.getSettings().controls.mouseSensitivity);
const pxPerStep = ((rate * Math.PI) / 180) * 0.05 / (0.0022 * sens);

async function sweep(dx, dy, name) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ({ dx, dy }) => {
        const c = document.querySelector('.rb-flight canvas');
        c.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
      },
      { dx: dx * pxPerStep, dy: dy * pxPerStep },
    );
    await page.waitForTimeout(50);
  }
  const info = await page.evaluate(() => {
    const s = window.__rb2.session;
    s.freeze(true);
    const p = s.player;
    const aimOff = s.rig.aimOffNose === null ? null : (s.rig.aimOffNose * 180) / Math.PI;
    return {
      headYawDeg: +((s.rig.headYaw * 180) / Math.PI).toFixed(1),
      headPitchDeg: +((s.rig.headPitch * 180) / Math.PI).toFixed(1),
      aimOffNoseDeg: aimOff === null ? null : +aimOff.toFixed(1),
      g: +p.state.gLoad.toFixed(2),
      ias: Math.round(p.state.airspeed * 3.6),
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${label}-${name}.png` });
  console.log(JSON.stringify({ label, name, ...info }));
  await page.evaluate(() => window.__rb2.session.freeze(false));
}

await sweep(1, 0, 'turn');
await sweep(0, -1, 'pull');
console.log(JSON.stringify({ errors: errors.slice(0, 5) }));
await browser.close();
