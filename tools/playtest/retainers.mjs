// Leak hunter for long sessions. Needs a dev server on <port>.
//
//   node tools/playtest/retainers.mjs <port> path [flights=3] [ctorName=WebGL2RenderingContext]
//     Fly N quick missions, snapshot the heap, and print the shortest retainer
//     path from a GC root to each live object with that constructor name.
//
//   node tools/playtest/retainers.mjs <port> diff [flights=2] [more=3]
//     Snapshot after N flights and again after N+more; print the object groups
//     (by constructor name) whose count/size grew the most. Growth that scales
//     with `more` is a per-flight leak.
import { chromium } from '@playwright/test';

const [port = '5323', mode = 'path', a = '', b = ''] = process.argv.slice(2);

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__rb2?.services, undefined, { timeout: 30000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');

let flown = 0;
async function flyN(n) {
  for (let i = 0; i < n; i++, flown++) {
    await page.evaluate((idx) => {
      const s = window.__rb2.services;
      const m = s.campaign.buildQuickMission({
        playerAircraft: idx % 2 ? 'fokker_dri' : 'sopwith_camel', enemyAircraft: idx % 2 ? 'se5a' : 'albatros_dv',
        enemyCount: 2, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 1500,
        startPosition: 'head-on', timeOfDay: 'morning', cloudCover: 0.3, type: 'dogfight',
      });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:1000';
      document.body.appendChild(host);
      window.__done = false;
      s.launcher.fly(m, s.getSettings(), host).finally(() => { host.remove(); window.__done = true; });
    }, flown);
    await page.waitForFunction(() => (window.__rb2?.session?.frames ?? 0) > 5, undefined, { timeout: 40000 });
    await page.keyboard.down('Space');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Space');
    await page.evaluate(() => window.__rb2.session.abandon());
    await page.waitForFunction(() => window.__done, undefined, { timeout: 20000 });
  }
}

async function snapshot() {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const on = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  return parse(JSON.parse(chunks.join('')));
}

function parse(snap) {
  const { node_fields, edge_fields, node_types, edge_types } = snap.snapshot.meta;
  const NF = node_fields.length, EF = edge_fields.length;
  const idx = (f, k) => f.indexOf(k);
  const nType = idx(node_fields, 'type'), nName = idx(node_fields, 'name'), nEdges = idx(node_fields, 'edge_count'), nSize = idx(node_fields, 'self_size');
  const eType = idx(edge_fields, 'type'), eName = idx(edge_fields, 'name_or_index'), eTo = idx(edge_fields, 'to_node');
  const { nodes, edges, strings } = snap;
  const count = nodes.length / NF;
  const first = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { first[i] = e; e += nodes[i * NF + nEdges] * EF; first[i + 1] = e; }
  return {
    count,
    name: (i) => strings[nodes[i * NF + nName]],
    type: (i) => node_types[0][nodes[i * NF + nType]],
    size: (i) => nodes[i * NF + nSize],
    *out(i) {
      for (let e = first[i]; e < first[i + 1]; e += EF) {
        const et = edge_types[0][edges[e + eType]];
        const v = edges[e + eName];
        yield { to: edges[e + eTo] / NF, weak: et === 'weak', label: et === 'element' || et === 'hidden' ? `[${v}]` : `.${strings[v]}` };
      }
    },
  };
}

function groups(h) {
  const m = new Map();
  for (let i = 0; i < h.count; i++) {
    const t = h.type(i);
    if (t === 'hidden' || t === 'synthetic') continue;
    const k = `${t}:${t === 'string' || t === 'concatenated string' || t === 'sliced string' ? '(string)' : h.name(i).slice(0, 60)}`;
    const g = m.get(k) ?? { n: 0, bytes: 0 };
    g.n++;
    g.bytes += h.size(i);
    m.set(k, g);
  }
  return m;
}

if (mode === 'diff') {
  await flyN(Number(a || 2));
  const g1 = groups(await snapshot());
  await flyN(Number(b || 3));
  const g2 = groups(await snapshot());
  const rows = [];
  for (const [k, v] of g2) {
    const o = g1.get(k) ?? { n: 0, bytes: 0 };
    if (v.n - o.n > 0 || v.bytes - o.bytes > 4096) rows.push({ group: k, dCount: v.n - o.n, dKB: Math.round((v.bytes - o.bytes) / 1024), count: v.n });
  }
  rows.sort((x, y) => y.dKB - x.dKB);
  console.table(rows.slice(0, 40));
} else {
  const target = b || 'WebGL2RenderingContext';
  await flyN(Number(a || 3));
  const h = await snapshot();
  const rev = Array.from({ length: h.count }, () => []);
  for (let i = 0; i < h.count; i++) for (const e of h.out(i)) if (!e.weak) rev[e.to].push([i, e.label]);
  const targets = [];
  const match = target.startsWith('~') ? (i) => h.name(i).startsWith(target.slice(1)) : (i) => h.name(i) === target && h.type(i) === 'object';
  for (let i = 0; i < h.count; i++) if (match(i)) targets.push(i);
  console.log(`${targets.length} live '${target}' object(s)`);
  for (const t of targets.slice(0, 5)) {
    // BFS from the target back towards the snapshot root (node 0).
    const next = new Map([[t, null]]);
    const q = [t];
    while (q.length) {
      const n = q.shift();
      if (n === 0) break;
      for (const [from, label] of rev[n]) if (!next.has(from)) { next.set(from, [n, label]); q.push(from); }
    }
    if (!next.has(0)) { console.log('  (unreachable from root)'); continue; }
    const path = [];
    for (let n = 0, guard = 0; n !== t && guard < 60; guard++) {
      const [child, label] = next.get(n);
      path.push(`${h.name(n).slice(0, 80)} (${h.type(n)}) ${label}`);
      n = child;
    }
    console.log('\n--- path from root');
    console.log(path.slice(1).map((s) => '  ' + s).join('\n') + `\n  => ${target}`);
  }
}
await browser.close();
