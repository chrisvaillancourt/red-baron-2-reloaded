#!/usr/bin/env node
/**
 * A/B soak runner (FRICTION F-22, F-8, F-9): run one soak two ways on the same seeds, in parallel,
 * and print the two results side by side with 95% intervals.
 *
 *   node tools/dev/ab.mjs --soak career --flag escalateDefence            # AI_TACTICS=<flag>=0 v =1
 *   node tools/dev/ab.mjs --soak fairness --set default,mirror --reps 48 --flag stalk
 *   node tools/dev/ab.mjs --soak quick --reps 24 --a AI_TACTICS=stalk=0 --b AI_TACTICS=stalk=1
 *   node tools/dev/ab.mjs --soak career --base HEAD~3                     # that commit v this tree
 *   node tools/dev/ab.mjs --soak career --flag x --env AUTOPLAY_PILOT=human
 *
 * Soaks: `career` (AUTOPLAY=career; one run per --seeds entry, AUTOPLAY_SEED_BASE, summed),
 * `quick` (AUTOPLAY=quick, --reps), `fairness` (AI_SOAK=fairness, --set, --reps).
 * Variants: `--flag f` sets AI_TACTICS=f=0 (A) and f=1 (B); `--a` / `--b` take comma-separated
 * KEY=VALUE env; `--base <ref>` runs A in a scratch `git worktree` at that ref (node_modules
 * linked from here) and B in this tree. `--env` adds KEY=VALUE to both. `--jobs` caps parallel
 * processes (default: half the cores, at most 6). Intervals overlapping means "within noise".
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { poissonInterval, wilsonInterval } from '../../src/game/testing/stats.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const { values: o } = parseArgs({
  options: {
    soak: { type: 'string' },
    flag: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    base: { type: 'string' },
    env: { type: 'string' },
    seeds: { type: 'string', default: '0,1000,2000' },
    missions: { type: 'string', default: '10' },
    reps: { type: 'string' },
    set: { type: 'string', default: 'default' },
    jobs: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const die = (msg) => {
  process.stderr.write(`ab: ${msg}\n(run with --help for usage)\n`);
  process.exit(2);
};
if (o.help) {
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0] + '*/\n');
  process.exit(0);
}
const SOAKS = ['career', 'quick', 'fairness'];
if (!SOAKS.includes(o.soak)) die(`--soak must be one of ${SOAKS.join(', ')}`);
const posInt = (name, v) => {
  if (!/^[1-9]\d*$/.test(String(v))) die(`--${name} must be a positive integer, got ${JSON.stringify(v)}`);
  return Number(v);
};
const envList = (s) =>
  Object.fromEntries(
    (s ?? '')
      .split(',')
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=');
        if (i < 1) die(`expected KEY=VALUE, got ${JSON.stringify(kv)}`);
        return [kv.slice(0, i), kv.slice(i + 1)];
      }),
  );
// "AI_TACTICS=stalk=0" splits at the first '=' only, so flag values survive.
let A = envList(o.a);
let B = envList(o.b);
if (o.flag) {
  A = { ...A, AI_TACTICS: [A.AI_TACTICS, `${o.flag}=0`].filter(Boolean).join(',') };
  B = { ...B, AI_TACTICS: [B.AI_TACTICS, `${o.flag}=1`].filter(Boolean).join(',') };
}
if (!o.flag && !o.a && !o.b && !o.base) die('give --flag, --a/--b, or --base');
const common = envList(o.env);
const jobs = o.jobs ? posInt('jobs', o.jobs) : Math.max(1, Math.min(6, Math.floor(cpus().length / 2)));
const seeds = o.soak === 'career' ? o.seeds.split(',').map((s) => (/^\d+$/.test(s) ? s : die(`bad seed ${s}`))) : ['-'];
const reps = o.reps ? posInt('reps', o.reps) : o.soak === 'fairness' ? 48 : 24;
const missions = posInt('missions', o.missions);

/** A scratch worktree at `ref`, sharing this tree's node_modules (never `cp -r` a worktree). */
function baseTree(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'rb2r-ab-'));
  execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', dir, ref], { stdio: 'ignore' });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function soakJob(cwd, env, seed, tag) {
  const out = join(mkdtempSync(join(tmpdir(), 'rb2r-ab-out-')), `${tag}.txt`);
  const e = { ...process.env, ...common, ...env };
  let file;
  if (o.soak === 'career') {
    Object.assign(e, { AUTOPLAY: 'career', AUTOPLAY_MISSIONS: String(missions), AUTOPLAY_SEED_BASE: seed, AUTOPLAY_OUT: out });
    file = 'src/game/autoplay.soak.test.ts';
  } else if (o.soak === 'quick') {
    Object.assign(e, { AUTOPLAY: 'quick', AUTOPLAY_QUICK_REPS: String(reps), AUTOPLAY_OUT: out });
    file = 'src/game/autoplay.soak.test.ts';
  } else {
    Object.assign(e, { AI_SOAK: 'fairness', AI_FAIR_SET: o.set, AI_FAIR_REPS: String(reps) });
    file = 'src/ai/fairness.soak.test.ts';
  }
  return { cwd, env: e, file, out, tag };
}

function run(job) {
  return new Promise((done) => {
    const vitest = join(job.cwd, 'node_modules/.bin/vitest');
    if (!existsSync(vitest)) die(`no vitest at ${vitest}; run sfw pnpm install`);
    const p = spawn(vitest, ['run', job.file], { cwd: job.cwd, env: job.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stdout += d));
    p.on('error', (err) => die(`could not start vitest: ${err.message}`));
    p.on('close', (code) => {
      const text = o.soak === 'fairness' ? stdout : existsSync(job.out) ? readFileSync(job.out, 'utf8') : '';
      if (code !== 0) process.stderr.write(`ab: ${job.tag} exited ${code}\n${stdout.slice(-2000)}\n`);
      process.stderr.write(`ab: ${job.tag} done\n`);
      done({ ...job, text, code });
    });
  });
}

async function pool(list) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, list.length) }, async () => {
      while (next < list.length) results.push(await run(list[next++]));
    }),
  );
  return results;
}

// ---- parse and summarise ----------------------------------------------------------
function ratesOf(texts) {
  const sum = { missions: 0, killedCaptured: 0, coll: 0, playerColl: 0 };
  for (const t of texts) {
    const line = t.split('\n').find((l) => l.startsWith('RATES '));
    if (!line) die('a run printed no RATES line (does its soak predate the RATES line? see FRICTION F-9)');
    const kv = Object.fromEntries(line.split(' ').slice(1).map((p) => p.split('=')));
    for (const k of Object.keys(sum)) sum[k] += Number(kv[k]);
  }
  return sum;
}
function fairnessOf(texts) {
  const rows = new Map();
  for (const t of texts)
    for (const l of t.split('\n')) {
      const m = /^(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+)%\s*\|\s*\d+% \((\d+)\/(\d+)\/(\d+)\)/.exec(l);
      if (!m) continue;
      const r = rows.get(m[1]) ?? { n: 0, down: 0, win: 0 };
      const n = Number(m[2]);
      r.n += n;
      r.win += Math.round((Number(m[3]) * n) / 100);
      r.down += Number(m[4]) + Number(m[5]) + Number(m[6]);
      rows.set(m[1], r);
    }
  return rows;
}
const pct = (k, n) => {
  const [lo, hi] = wilsonInterval(k, n);
  return `${((100 * k) / Math.max(1, n)).toFixed(1)}% (${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)})`;
};
const per100 = (k, n) => {
  const [lo, hi] = poissonInterval(k);
  const f = (x) => ((100 * x) / Math.max(1, n)).toFixed(1);
  return `${f(k)} (${f(lo)}–${f(hi)})`;
};
const overlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];
const verdict = (ka, na, kb, nb) => (overlap(wilsonInterval(ka, na), wilsonInterval(kb, nb)) ? 'within noise' : 'differs');

async function main() {
  const trees = [];
  const aCwd = o.base ? baseTree(o.base) : ROOT;
  if (o.base) trees.push(aCwd);
  const list = [];
  for (const s of seeds) {
    list.push(soakJob(aCwd, A, s, `A-seed${s}`));
    list.push(soakJob(ROOT, B, s, `B-seed${s}`));
  }
  const label = (env, cwd) => [cwd !== ROOT ? `commit ${o.base}` : 'this tree', ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join(', ');
  process.stderr.write(`ab: ${list.length} runs, ${jobs} at a time\n`);
  try {
    const res = await pool(list);
    const byVariant = (v) => res.filter((r) => r.tag.startsWith(v)).map((r) => r.text);
    const lines = [`A/B ${o.soak}${o.soak === 'career' ? ` (seeds ${seeds.join(' ')}; ${missions} mission${missions > 1 ? 's' : ''} a pilot)` : ` (${reps} reps)`}`, `  A: ${label(A, aCwd)}`, `  B: ${label(B, ROOT)}`];
    if (Object.keys(common).length) lines.push(`  both: ${Object.entries(common).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (o.soak === 'fairness') {
      const ra = fairnessOf(byVariant('A'));
      const rb = fairnessOf(byVariant('B'));
      lines.push('setup | player down A | player down B | verdict');
      for (const [k, a] of ra) {
        const b = rb.get(k);
        if (!b) continue;
        lines.push(`${k} | ${pct(a.down, a.n)} n=${a.n} | ${pct(b.down, b.n)} n=${b.n} | ${verdict(a.down, a.n, b.down, b.n)}`);
      }
    } else {
      const a = ratesOf(byVariant('A'));
      const b = ratesOf(byVariant('B'));
      lines.push('metric | A | B | verdict');
      lines.push(`killed or captured | ${pct(a.killedCaptured, a.missions)} n=${a.missions} | ${pct(b.killedCaptured, b.missions)} n=${b.missions} | ${verdict(a.killedCaptured, a.missions, b.killedCaptured, b.missions)}`);
      const pv = overlap(poissonInterval(a.coll).map((x) => x / a.missions), poissonInterval(b.coll).map((x) => x / b.missions)) ? 'within noise' : 'differs';
      lines.push(`collisions per 100 missions | ${per100(a.coll, a.missions)} | ${per100(b.coll, b.missions)} | ${pv}`);
      lines.push(`player collisions | ${a.playerColl} | ${b.playerColl} |`);
      if (o.soak === 'career' && o.base) lines.push('note: career seeds draw different squadrons across commits, so --base compares are about the whole career, not mission by mission');
    }
    process.stdout.write(lines.join('\n') + '\n');
    if (res.some((r) => r.code !== 0)) process.exitCode = 1;
  } finally {
    for (const t of trees) execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', t], { stdio: 'ignore' });
  }
}
main();
