// Fly a flight report again (docs/PLAYTEST.md "Human playtests").
//
//   node tools/playtest/replay-report.mjs <report.json> [--reps N] [--maxtime S]
//     Headless: the autoplayer flies the report's mission N times (default 8) at the report's
//     realism settings and prints the fairness soak's summary row (src/game/replay.soak.test.ts).
//
//   node tools/playtest/replay-report.mjs <report.json> --browser [--port 5173] [--out dir] [--timeout S] [--vulnerable]
//     Real app: launches the report's mission in a running dev server (`pnpm dev --port <port>`)
//     through the window.__rb2 dev hooks, with the report's realism, mouse mode and graphics.
//     Nobody flies the player's aircraft, so it holds its course and is made invulnerable
//     (--vulnerable keeps the report's setting). Time compression runs until enemies come near.
//     It saves cockpit and padlock screenshots at the start, when the nearest enemy closes inside
//     1.5 km, at the merge (600 m), and 4 s later, and logs range, height and sun angle.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
if (!file) {
  console.error('usage: node tools/playtest/replay-report.mjs <report.json> [--reps N] [--maxtime S] | --browser [--port P] [--out dir] [--timeout S] [--vulnerable]');
  process.exit(2);
}
const path = resolve(file);
const report = JSON.parse(readFileSync(path, 'utf8'));
if (report.kind !== 'rb2r-flight-report' || report.schema !== 1) {
  console.error(`${file}: not a schema-1 flight report (kind ${report.kind}, schema ${report.schema})`);
  process.exit(2);
}

if (!flag('browser')) {
  const r = spawnSync('./node_modules/.bin/vitest', ['run', 'src/game/replay.soak.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, REPLAY: path, REPLAY_REPS: opt('reps', '8'), REPLAY_MAXTIME: opt('maxtime', '2400') },
  });
  process.exit(r.status ?? 1);
}

const port = Number(opt('port', '5173'));
const out = opt('out', `test-results/replay-${basename(file, '.json')}`);
const timeout = Number(opt('timeout', '300'));
mkdirSync(out, { recursive: true });
try {
  await fetch(`http://localhost:${port}/`);
} catch {
  console.error(`No dev server on port ${port}. Start one with: pnpm dev --port ${port}`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__rb2?.services);
await page.evaluate(
  async ([rep, vulnerable]) => {
    const s = window.__rb2.services;
    const settings = structuredClone(s.getSettings());
    // The report's realism over this build's defaults, so fields added since the report was
    // written get their defaults (src/core/flightReport.ts realismFromReport).
    const { DEFAULT_SETTINGS } = await import('/src/core/settings.ts');
    settings.realism = { ...DEFAULT_SETTINGS.realism, ...rep.settings.realism };
    if (!vulnerable) settings.realism.invulnerable = true;
    settings.controls.mouseMode = rep.settings.mouseMode;
    settings.graphics = rep.settings.graphics;
    settings.showTutorialHints = false;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50';
    document.body.appendChild(host);
    window.__replayDone = false;
    s.launcher.fly(rep.mission, settings, host).finally(() => (window.__replayDone = true));
  },
  [report, flag('vulnerable')],
);
await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 60_000 });

/** Nearest live enemy to the player: range, height difference, angle off the sun, AI state. */
const probe = () =>
  page.evaluate(() => {
    const s = window.__rb2?.session;
    if (!s?.player) return null;
    const w = s.world;
    const p = s.player;
    let best = null;
    for (const a of w.aircraft) {
      if (a.side === p.side || a.outcome) continue;
      const r = a.state.position.distanceTo(p.state.position);
      if (!best || r < best.r) best = { a, r };
    }
    if (!best) return { t: w.time, r: Infinity, info: 'no enemy' };
    const e = best.a;
    const los = e.state.position.clone().sub(p.state.position).normalize();
    const sun = w.sunDirection;
    const sunDeg = sun ? Math.round((Math.acos(Math.min(1, los.dot(sun))) * 180) / Math.PI) : null;
    const dh = Math.round(e.state.position.y - p.state.position.y);
    return { t: w.time, r: best.r, info: `t=${w.time.toFixed(0)}s ${e.callsign} "${s.aiState?.(e.id) ?? ''}" r=${best.r.toFixed(0)}m dh=${dh}m sun=${sunDeg ?? '-'}°` };
  });

async function shots(tag) {
  const pr = await probe();
  for (const view of ['cockpit', 'padlock']) {
    await page.evaluate((v) => window.__rb2.session.command(v === 'padlock' ? 'padlockNearest' : 'viewCockpit'), view);
    await page.waitForTimeout(250);
    const f = `${out}/${tag}-${view}.jpg`;
    await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
    console.log(`${f}  ${pr?.info ?? ''}`);
  }
  await page.evaluate(() => window.__rb2.session.command('viewCockpit'));
}

await shots('0-start');
// Compress time on the way in; the session drops it by itself when enemies come near.
for (let i = 0; i < 3; i++) await page.evaluate(() => window.__rb2.session.command('timeCompress'));
const stages = [
  { tag: '1-inside-1500m', at: 1500 },
  { tag: '2-merge-600m', at: 600 },
];
let mergeT = null;
for (const st of stages) {
  const hit = await page
    .waitForFunction(
      ([at, lim]) => {
        const s = window.__rb2?.session;
        if (!s?.player || window.__replayDone) return 'ended';
        if (s.world.time > lim) return 'timeout';
        const p = s.player.state.position;
        return s.world.aircraft.some((a) => a.side !== s.player.side && !a.outcome && a.state.position.distanceTo(p) < at) ? 'ok' : false;
      },
      [st.at, timeout],
      { timeout: 0, polling: 100 },
    )
    .then((h) => h.jsonValue());
  if (hit !== 'ok') {
    console.log(`${st.tag}: ${hit === 'ended' ? 'the flight ended first' : `no enemy inside ${st.at} m by t=${timeout}s`}`);
    break;
  }
  await shots(st.tag);
  if (st.at === 600) mergeT = (await probe())?.t ?? null;
}
if (mergeT !== null) {
  await page.waitForFunction((t) => (window.__rb2?.session?.world?.time ?? Infinity) >= t || window.__replayDone, mergeT + 4, { timeout: 60_000 });
  if (!(await page.evaluate(() => window.__replayDone))) await shots('3-merge-plus-4s');
}
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
