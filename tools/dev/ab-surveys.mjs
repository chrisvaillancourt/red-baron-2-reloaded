import { poissonInterval, wilsonInterval } from '../../src/game/testing/stats.ts';

const fail = (message) => { throw new Error(message); };
const integer = (value, name, positive = false) => {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || (positive && Number(value) === 0)) {
    fail(`invalid ${name}: ${JSON.stringify(value)}`);
  }
  return Number(value);
};
const count = (value, n, name) => {
  const k = integer(value, name);
  if (k > n) fail(`${name} ${k} exceeds denominator ${n}`);
  return k;
};
const expectedReps = (n, reps, label) => {
  if (reps !== undefined && n !== reps) fail(`${label}: expected ${reps} repetitions, got ${n}`);
};
const put = (rows, key, value) => {
  if (rows.has(key)) fail(`duplicate survey row ${key}`);
  rows.set(key, value);
};
const sameKeys = (a, b) => {
  if (a.size !== b.size || [...a.keys()].some((k) => !b.has(k))) fail('paired setup keys differ; no comparison emitted');
};
const nonempty = (rows, name) => {
  if (!rows.size) fail(`no ${name} survey rows (wrong mode, unknown set, or incomplete output)`);
  return rows;
};
const ratio = (s, name, subset = true) => {
  const m = /^(\d+)\/(\d+)(?: \((\d+%|-)\))?$/.exec(s);
  if (!m) fail(`invalid ${name}: ${JSON.stringify(s)}`);
  const n = integer(m[2], name);
  if (subset) count(m[1], n, name);
  else integer(m[1], name);
  if (m[3] === '-') {
    if (n !== 0) fail(`undefined ${name} percentage with nonzero denominator`);
  } else if (m[3] !== undefined) percent(m[3], name);
  return `${m[1]}/${m[2]}`;
};
const percent = (s, name) => {
  if (!/^(?:100|\d{1,2})%$/.test(s)) fail(`invalid ${name}: ${JSON.stringify(s)}`);
  return s;
};

function ratesOf(texts) {
  const sum = { missions: 0, killedCaptured: 0, coll: 0, playerColl: 0 };
  for (const text of texts) {
    const lines = text.split('\n').filter((l) => l.startsWith('RATES '));
    if (lines.length !== 1) fail('expected exactly one RATES line per run (older soaks may predate F-9)');
    const kv = Object.fromEntries(lines[0].split(/\s+/).slice(1).map((p) => p.split('=')));
    const n = integer(kv.missions, 'missions', true);
    sum.missions += n;
    sum.killedCaptured += count(kv.killedCaptured, n, 'killedCaptured');
    const coll = integer(kv.coll, 'coll');
    sum.coll += coll;
    sum.playerColl += count(kv.playerColl, coll, 'playerColl');
  }
  return sum;
}

function fairnessOf(texts, reps) {
  const rows = new Map();
  for (const text of texts) for (const line of text.split('\n')) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 4 || parts[1] === 'n') continue;
    const m = /^(\d+)% \((\d+)\/(\d+)\/(\d+)\)$/.exec(parts[3]);
    // Any numeric table row must match the actual fate-count reporter.
    if (!/^\d+$/.test(parts[1])) continue;
    if (!m) fail(`malformed fairness row ${parts[0]}`);
    const n = integer(parts[1], `${parts[0]} n`, true);
    expectedReps(n, reps, parts[0]);
    percent(parts[2], 'win percentage');
    percent(`${m[1]}%`, 'down percentage');
    const down = count(Number(m[2]) + Number(m[3]) + Number(m[4]), n, 'player down');
    // Overlapping named sets rerun the same matchup with the same seed schedule.
    // Keep one identical observation, never inflate n or silently replace disagreement.
    const report = parts.join('|');
    const previous = rows.get(parts[0]);
    if (previous) {
      if (previous.report !== report) fail(`conflicting fairness row ${parts[0]}`);
      continue;
    }
    put(rows, parts[0], { n, down, report });
  }
  return nonempty(rows, 'fairness');
}

function raidOf(texts, reps) {
  const rows = new Map();
  for (const text of texts) for (const line of text.split('\n')) {
    const p = line.split('|').map((v) => v.trim());
    if (p.length < 2 || !/^\d+$/.test(p[1])) continue;
    if (p.length !== 10) fail(`malformed raid row ${p[0]}`);
    const n = integer(p[1], `${p[0]} n`, true);
    expectedReps(n, reps, p[0]);
    const down = /^(\d+) \((\d+)%\)$/.exec(p[9]);
    if (!down) fail(`invalid player down: ${p[9]}`);
    count(down[1], n, 'player down');
    percent(`${down[2]}%`, 'player down percentage');
    const dropped = ratio(p[2], 'dropped/carried');
    const onTarget = ratio(p[3], 'on target/dropped');
    if (onTarget.split('/')[1] !== dropped.split('/')[0]) fail('raid dropped denominators disagree');
    put(rows, p[0], {
      runs: String(n),
      'dropped/carried': dropped,
      'on target/dropped': onTarget,
      // groundDestroyed includes incidental AA, while the denominator is the bomb waypoint's targetIds.
      'ground destroyed/objective targets': ratio(p[4], 'ground destroyed/objective targets', false),
      'success (rounded)': percent(p[5], 'success'),
      'bombers lost/total': ratio(p[6], 'bombers lost'),
      'escorts lost/total': ratio(p[7], 'escorts lost'),
      'interceptors lost/total': ratio(p[8], 'interceptors lost'),
      'player down/runs': `${down[1]}/${n}`,
    });
  }
  return nonempty(rows, 'raid');
}

function defenceOf(texts, reps) {
  const rows = new Map();
  for (const text of texts) {
    let header;
    let modes = 0;
    const completeCase = () => { if (header && modes === 0) fail(`incomplete defence survey ${header.case}`); };
    for (const line of text.split('\n')) {
      const h = /^defence (.+), pursuer (human-like|veteran autoplayer), (\d+) seeds$/.exec(line);
      if (h) {
        completeCase();
        header = { case: h[1], pursuer: h[2], n: integer(h[3], 'defence seeds', true) };
        expectedReps(header.n, reps, header.case);
        modes = 0;
        continue;
      }
      if (!header || !/^\s+(off|brake|ladder|mix)\s+flew /.test(line)) continue;
      const m = /^\s+(off|brake|ladder|mix)\s+flew (\d+) s, attacking (\d+) s, tail held (\d+) s \(circling (\d+)%, varied (\d+)%, (\d+\.\d+) kinds\/episode over (\d+), longest (\d+) s\), hits taken (\d+), down (\d+)\/(\d+), unhit crashes (\d+), pursuer fixed guns (\d+)\/(\d+) \((\d+)%\)$/.exec(line);
      if (!m) fail(`malformed defence survey row: ${line}`);
      const n = integer(m[12], 'defence down denominator', true);
      if (n !== header.n) fail('defence seed and down denominators disagree');
      count(m[11], n, 'defence down');
      count(m[13], 2 * n, 'unhit crashes'); // defender and pursuer are both counted
      ratio(`${m[14]}/${m[15]}`, 'pursuer fixed guns');
      percent(`${m[5]}%`, 'circling');
      percent(`${m[6]}%`, 'varied');
      percent(`${m[16]}%`, 'pursuer accuracy');
      put(rows, `${header.case}\n${m[1]}`, {
        case: header.case,
        mode: m[1], pursuer: header.pursuer, seeds: String(n),
        'flown s (rounded)': m[2], 'attacking s (rounded)': m[3], 'tail held s (rounded)': m[4],
        circling: `${m[5]}%`, varied: `${m[6]}%`, 'kinds/episode': `${m[7]} (${m[8]} episodes)`,
        'longest hold s (rounded)': m[9], 'hits taken (total)': m[10],
        'down/seeds': `${m[11]}/${n}`, 'unhit crashes': m[13], 'fixed gun hits/rounds': `${m[14]}/${m[15]}`,
      });
      modes++;
    }
    completeCase();
  }
  nonempty(rows, 'defence');
  if (new Set([...rows.values()].map((r) => r.case)).size !== 2) fail('expected both real-sim defence survey cases');
  return rows;
}

function tailholdOf(texts, reps) {
  const setups = new Map();
  for (const text of texts) {
    let setup;
    const reportHeader = /^tailhold set=.+ reps=(\d+) AI_TACTICS=.* player=(human-like|veteran)$/m.exec(text);
    if (!reportHeader) fail('missing tailhold survey header/pursuer');
    expectedReps(integer(reportHeader[1], 'tailhold reps', true), reps, 'tailhold header');
    for (const line of text.split('\n')) {
      const h = /^== (.+) \((\d+) runs\): player down (\d+), player crashed (\d+), crashes (.*), player fixed guns (\d+)\/(\d+) \((?:\d+\.\d+|-)%\)$/.exec(line);
      if (h) {
        const n = integer(h[2], 'tailhold runs', true);
        expectedReps(n, reps, h[1]);
        count(h[3], n, 'tailhold player down');
        count(h[4], n, 'tailhold player crashes');
        ratio(`${h[6]}/${h[7]}`, 'fixed gun hits');
        setup = { metrics: { pursuer: reportHeader[2], runs: String(n), 'player down/runs': `${h[3]}/${n}`, 'player crashes': h[4], crashes: h[5], 'fixed gun hits/rounds': `${h[6]}/${h[7]}` }, buckets: new Map() };
        put(setups, h[1], setup);
        continue;
      }
      if (line.startsWith('== ')) fail(`malformed tailhold setup: ${line}`);
      if (!setup || !line.includes('| held ')) continue;
      const p = line.trim().split(' | ');
      const specs = [
        ['held s/run', /^held (\d+) s\/run$/], ['circle', /^circle (\d+)%$/], ['varied', /^varied (\d+)%$/],
        ['kinds/episode', /^kinds\/episode (\d+\.\d+) \((\d+)\)$/], ['flat', /^flat (\d+)%$/],
        ['bank deg', /^bank (\d+) deg$/], ['dh m/run', /^dh (-?\d+) m\/run$/], ['longest s', /^longest (\d+) s$/],
        ['stretches', /^stretches (\d+)$/], ['hits taken/run', /^hits taken (\d+\.\d+)\/run \((\d+\.\d+)\/s\)$/],
      ];
      if (p.length !== 12 || !p[11].startsWith('states: ')) fail(`malformed tailhold bucket ${p[0]}`);
      const metrics = {};
      specs.forEach(([name, re], i) => {
        const m = re.exec(p[i + 1]);
        if (!m) fail(`invalid tailhold ${name}: ${p[i + 1]}`);
        if (['circle', 'varied', 'flat'].includes(name)) percent(`${m[1]}%`, name);
        metrics[name] = m[1] + (m[2] ? ` (${m[2]}${name === 'kinds/episode' ? ' episodes' : '/s'})` : '') + (['circle', 'varied', 'flat'].includes(name) ? '%' : '');
      });
      put(setup.buckets, p[0], metrics);
    }
  }
  return nonempty(setups, 'tailhold');
}

const overlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];
const verdict = (ka, na, kb, nb) => overlap(wilsonInterval(ka, na), wilsonInterval(kb, nb)) ? 'within noise' : 'differs';
const pct = (k, n) => {
  const [lo, hi] = wilsonInterval(k, n);
  return `${(100 * k / n).toFixed(1)}% (${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}) n=${n}`;
};
const per100 = (k, n) => {
  const [lo, hi] = poissonInterval(k);
  const f = (v) => (100 * v / n).toFixed(1);
  return `${f(k)} (${f(lo)}–${f(hi)})`;
};
const descriptiveRows = (lines, label, a, b) => {
  for (const metric of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    lines.push(`${label} / ${metric} | ${a?.[metric] ?? 'not observed'} | ${b?.[metric] ?? 'not observed'}`);
  }
};

/** Summarise actual completed reports, refusing failed workers and incomparable cohorts. */
export function summarizeComparison(soak, results, { reps } = {}) {
  if (!results.length) fail('no completed survey runs');
  for (const r of results) if (r.code !== 0 || r.signal || r.error) fail(`${r.tag} exited ${r.code ?? r.signal ?? 'without a result'}${r.error ? `: ${r.error}` : ''}; inspect raw evidence`);
  const byVariant = (v) => {
    const texts = results.filter((r) => r.variant === v).map((r) => r.text);
    if (!texts.length || texts.some((t) => !t.trim())) fail(`missing ${v} survey output`);
    return texts;
  };
  const ta = byVariant('A');
  const tb = byVariant('B');
  const lines = [];
  if (soak === 'career' || soak === 'quick') {
    const a = ratesOf(ta), b = ratesOf(tb);
    if (a.missions !== b.missions && soak === 'quick') fail('paired quick mission counts differ');
    lines.push('metric | A | B | verdict');
    lines.push(`killed or captured | ${pct(a.killedCaptured, a.missions)} | ${pct(b.killedCaptured, b.missions)} | ${verdict(a.killedCaptured, a.missions, b.killedCaptured, b.missions)}`);
    const pv = overlap(poissonInterval(a.coll).map((x) => x / a.missions), poissonInterval(b.coll).map((x) => x / b.missions)) ? 'within noise' : 'differs';
    lines.push(`collisions per 100 missions | ${per100(a.coll, a.missions)} | ${per100(b.coll, b.missions)} | ${pv}`);
    lines.push(`player collisions | ${a.playerColl} | ${b.playerColl} |`);
  } else if (soak === 'fairness') {
    const a = fairnessOf(ta, reps), b = fairnessOf(tb, reps);
    sameKeys(a, b);
    lines.push('setup | player down A | player down B | verdict');
    for (const [label, r] of a) {
      const s = b.get(label);
      lines.push(`${label} | ${pct(r.down, r.n)} | ${pct(s.down, s.n)} | ${verdict(r.down, r.n, s.down, s.n)}`);
    }
  } else {
    lines.push('Descriptive aggregates only; rounded figures have no sampling intervals or significance claim.', 'setup / metric | A | B');
    if (soak === 'raid') {
      const a = raidOf(ta, reps), b = raidOf(tb, reps);
      sameKeys(a, b);
      for (const [label, r] of a) descriptiveRows(lines, label, r, b.get(label));
    } else if (soak === 'defence') {
      const a = defenceOf(ta, reps), b = defenceOf(tb, reps);
      const group = (rows) => {
        const cases = new Map();
        for (const row of rows.values()) {
          const list = cases.get(row.case) ?? [];
          list.push(row); cases.set(row.case, list);
        }
        return cases;
      };
      const ca = group(a), cb = group(b);
      sameKeys(ca, cb);
      for (const [label, ra] of ca) {
        const rb = cb.get(label);
        // One explicitly selected mode on each side may differ; multi-mode surveys must match modes.
        const single = ra.length === 1 && rb.length === 1;
        const ma = new Map(ra.map((r) => [single ? label : r.mode, r]));
        const mb = new Map(rb.map((r) => [single ? label : r.mode, r]));
        sameKeys(ma, mb);
        for (const [key, r] of ma) {
          const s = mb.get(key);
          if (r.pursuer !== s.pursuer) fail(`paired defence pursuers differ for ${label}`);
          const { case: _, ...am } = r, { case: __, ...bm } = s;
          descriptiveRows(lines, single ? label : `${label} (${key})`, am, bm);
        }
      }
    } else if (soak === 'tailhold') {
      const a = tailholdOf(ta, reps), b = tailholdOf(tb, reps);
      sameKeys(a, b);
      for (const [label, r] of a) {
        const s = b.get(label);
        if (r.metrics.pursuer !== s.metrics.pursuer) fail(`paired tailhold pursuers differ for ${label}`);
        descriptiveRows(lines, label, r.metrics, s.metrics);
        for (const bucket of new Set([...r.buckets.keys(), ...s.buckets.keys()])) {
          descriptiveRows(lines, `${label} / ${bucket}`, r.buckets.get(bucket), s.buckets.get(bucket));
        }
      }
    } else fail(`unknown soak ${soak}`);
  }
  return lines.join('\n');
}
