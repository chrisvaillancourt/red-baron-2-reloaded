import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * Long-session soak (gated: E2E_SOAK=1). Flies N consecutive flights in one
 * page, alternating quick and career missions, and checks that everything a
 * flight allocates is released when it ends: live WebGL contexts, workers,
 * rAF loops, DOM nodes, event listeners, JS heap and audio loops.
 *
 *   E2E_SOAK=1 E2E_PORT=5323 pnpm e2e tests/e2e/soak.spec.ts
 *   E2E_SOAK_FLIGHTS=20 (default 20)
 */

const FLIGHTS = Number(process.env.E2E_SOAK_FLIGHTS ?? 20);
test.skip(!process.env.E2E_SOAK, 'soak test: set E2E_SOAK=1');
test.setTimeout(60_000 + FLIGHTS * 45_000);

type Win = Window & {
  __result?: unknown;
  __probe: { liveContexts: number; totalContexts: number; rafPerSec(): Promise<number>; liveAudioSources: number };
};

/** Instrument the page before any app code runs. */
const PROBE = () => {
  const w = window as unknown as Win;
  const live = new Set<WeakRef<WebGLRenderingContext | WebGL2RenderingContext>>();
  let total = 0;
  const origGet = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, id: string, o?: unknown) => RenderingContext | null;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, o?: unknown) {
    const ctx = origGet.call(this, id, o);
    const tagged = this as unknown as { __probed?: boolean };
    if (ctx && (id === 'webgl2' || id === 'webgl') && !tagged.__probed) {
      // Weak: the probe must not keep contexts (or their canvases) alive itself.
      tagged.__probed = true;
      live.add(new WeakRef(ctx as WebGL2RenderingContext));
      total++;
    }
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
  // Live audio sources: started and not yet ended. A loop that is never stopped stays live forever.
  let liveSources = 0;
  const src = window.AudioScheduledSourceNode?.prototype;
  if (src) {
    const origStart = src.start;
    src.start = function (this: AudioScheduledSourceNode, ...a: number[]) {
      const tagged = this as unknown as { __live?: boolean };
      if (!tagged.__live) {
        tagged.__live = true;
        liveSources++;
        this.addEventListener('ended', () => liveSources--, { once: true });
      }
      return origStart.apply(this, a as [number?]);
    };
  }
  let rafCalls = 0;
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    rafCalls++;
    return origRaf(cb);
  };
  w.__probe = {
    get liveContexts() {
      // Contexts still reachable (not garbage-collected) and not lost.
      let n = 0;
      for (const r of live) {
        const c = r.deref();
        if (c && !c.isContextLost()) n++;
        else live.delete(r);
      }
      return n;
    },
    get totalContexts() {
      return total;
    },
    get liveAudioSources() {
      return liveSources;
    },
    rafPerSec: () =>
      new Promise((res) => {
        const start = rafCalls;
        setTimeout(() => res(rafCalls - start), 1000);
      }),
  };
};

interface Sample {
  flight: number;
  heapMB: number;
  nodes: number;
  listeners: number;
  workers: number;
  liveContexts: number;
  rafPerSec: number;
  liveAudioSources: number;
}

async function sample(page: Page, cdp: CDPSession, flight: number): Promise<Sample> {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
  const m = (n: string) => metrics.find((x) => x.name === n)?.value ?? NaN;
  const probe = await page.evaluate(async () => {
    const p = (window as unknown as Win).__probe;
    window.__rb2!.services!.audio.playMusic('none');
    await new Promise((r) => setTimeout(r, 3000)); // let crossfades and note tails end
    const raf = await p.rafPerSec();
    return { liveContexts: p.liveContexts, raf, liveAudio: p.liveAudioSources };
  });
  return {
    flight,
    heapMB: Math.round((m('JSHeapUsedSize') / 1048576) * 10) / 10,
    nodes: m('Nodes'),
    listeners: m('JSEventListeners'),
    workers: page.workers().length,
    liveContexts: probe.liveContexts,
    rafPerSec: probe.raf,
    liveAudioSources: probe.liveAudio,
  };
}

async function flyOnce(page: Page, i: number): Promise<void> {
  await page.evaluate((idx) => {
    const s = window.__rb2!.services!;
    let mission;
    if (idx % 2 === 0) {
      const types = ['dogfight', 'balloon-attack', 'escort', 'intercept', 'ground-attack'] as const;
      mission = s.campaign.buildQuickMission({
        playerAircraft: idx % 4 === 0 ? 'sopwith_camel' : 'fokker_dri',
        enemyAircraft: idx % 4 === 0 ? 'albatros_dv' : 'se5a',
        enemyCount: 3,
        wingmen: 2,
        enemySkill: 'regular',
        wingmanSkill: 'regular',
        altitudeM: 1500,
        startPosition: 'head-on',
        timeOfDay: 'morning',
        cloudCover: 0.4,
        type: types[(idx / 2) % types.length],
      });
    } else {
      const nations = ['germany', 'britain', 'france', 'usa'] as const;
      const pilot = s.campaign.createPilot({
        firstName: 'Soak',
        lastName: `Test${idx}`,
        nation: nations[((idx - 1) / 2) % 4],
        startDate: ['1916-09-01', '1917-04-10', '1917-10-01', '1918-06-01'][((idx - 1) / 2) % 4],
        difficulty: 'pilot',
      });
      mission = s.campaign.generateMission(pilot);
      s.campaign.deletePilot(pilot.id);
    }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.appendChild(host);
    (window as unknown as Win).__result = undefined;
    void s.launcher.fly(mission, s.getSettings(), host).then(
      (r) => {
        host.remove();
        (window as unknown as Win).__result = r;
      },
      (e) => {
        host.remove();
        (window as unknown as Win).__result = { error: String(e) };
      },
    );
  }, i);
  await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 40_000 });
  // Fly a little with guns and views so effects, tracers and audio loops all run.
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__rb2!.session!.command('viewChase'));
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  await page.evaluate(() => window.__rb2!.session!.command('viewCockpit'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rb2!.session!.abandon());
  await page.waitForFunction(() => (window as unknown as Win).__result !== undefined, undefined, { timeout: 20_000 });
  const r = await page.evaluate(() => (window as unknown as Win).__result as { error?: string });
  expect(r.error, `flight ${i} failed`).toBeUndefined();
}

test(`soak: ${FLIGHTS} consecutive flights release their resources`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  await page.addInitScript(PROBE);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  // Warm-up flight: module-level caches (aircraft templates, livery textures, shaders) fill once.
  await flyOnce(page, 0);
  const base = await sample(page, cdp, 0);
  const samples: Sample[] = [base];
  for (let i = 1; i < FLIGHTS; i++) {
    await flyOnce(page, i);
    samples.push(await sample(page, cdp, i));
  }
  console.table(samples);
  const last = samples[samples.length - 1];
  const lastFive = samples.slice(-5);

  // No flight leaves a live GL context, a worker or a rAF loop behind.
  for (const s of samples) {
    expect(s.liveContexts, `live WebGL contexts after flight ${s.flight}`).toBe(0);
    expect(s.workers, `workers after flight ${s.flight}`).toBe(0);
    expect(s.rafPerSec, `rAF callbacks/s in menus after flight ${s.flight}`).toBeLessThanOrEqual(base.rafPerSec + 2);
    expect(s.liveAudioSources, `live audio sources (music off) after flight ${s.flight}`).toBeLessThanOrEqual(base.liveAudioSources + 2);
  }
  // DOM and listeners return to baseline (small slack for toasts/menus).
  expect(last.nodes).toBeLessThan(base.nodes + 400);
  expect(last.listeners).toBeLessThan(base.listeners + 60);
  // Heap: bounded growth, and no steady per-flight climb over the last flights.
  expect(last.heapMB).toBeLessThan(base.heapMB + 40);
  const slope = (lastFive[lastFive.length - 1].heapMB - lastFive[0].heapMB) / (lastFive.length - 1);
  expect(slope, 'heap MB per flight over the last 5 flights').toBeLessThan(2);
  expect(errors).toEqual([]);
});
