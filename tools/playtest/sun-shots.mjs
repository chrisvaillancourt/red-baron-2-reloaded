// Sun-glare check: launches a quick mission, then frames an enemy aircraft from
// 350 m (1) straight out of the sun and (2) with the sun off to the side, with the
// HUD on so the glare overlay (src/ui/hud, HudView.sunGlare) is drawn.
//
//   node tools/playtest/sun-shots.mjs <outDir> [port] [timeOfDay]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/sun';
const port = Number(process.argv[3] ?? 5342);
const tod = process.argv[4] ?? 'afternoon';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__rb2?.services);
await page.evaluate((tod) => {
  const s = window.__rb2.services;
  const settings = structuredClone(s.getSettings());
  settings.realism.invulnerable = true;
  const mission = s.campaign.buildQuickMission({ playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 1, wingmen: 0, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1800, startPosition: 'head-on', timeOfDay: tod, cloudCover: 0.2, type: 'dogfight', date: '1917-07-10' });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:50';
  document.body.appendChild(host);
  s.launcher.fly(mission, settings, host);
}, tod);
await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });
await page.waitForTimeout(2000);
for (const mode of ['in-sun', 'side-sun']) {
  await page.evaluate((mode) => {
    const w = window.__rb2.session.world;
    const sun = w.sunDirection;
    window.__rb2render.debugCameraHook = (cam) => {
      const enemy = w.aircraft.find((a) => a.side !== window.__rb2.session.player.side && !a.outcome);
      if (!enemy) return;
      const V = cam.position.constructor;
      // Line of sight from the camera to the enemy: along the sun, or 60° to its left.
      const los = mode === 'in-sun' ? sun.clone() : sun.clone().applyAxisAngle(new V(0, 1, 0), Math.PI / 3);
      cam.position.copy(enemy.state.position).addScaledVector(los, -350);
      cam.up.set(0, 1, 0);
      cam.lookAt(enemy.state.position);
    };
  }, mode);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/sun-${tod}-${mode}.png` });
}
console.log(errors.length ? `errors: ${errors.join('\n')}` : 'no console errors');
await browser.close();
