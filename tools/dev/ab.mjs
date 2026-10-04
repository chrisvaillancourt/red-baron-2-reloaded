#!/usr/bin/env node
/**
 * Paired A/B surveys on identical seeds and repetition counts.
 *
 *   node tools/dev/ab.mjs --soak career --flag stalk --seeds 0,1000,2000
 *   node tools/dev/ab.mjs --soak fairness --set default,mirror --reps 48 --flag stalk
 *   node tools/dev/ab.mjs --soak tailhold --set default,low --flag escalateDefence
 *   node tools/dev/ab.mjs --soak defence --reps 24 --a DEFENCE_AB=off --b DEFENCE_AB=mix
 *   node tools/dev/ab.mjs --soak raid --set escort --flag bomberFormation
 *   node tools/dev/ab.mjs --soak quick --a AI_TACTICS=stalk=0,blindSpot=0 --b AI_TACTICS=stalk=1,blindSpot=1
 *   node tools/dev/ab.mjs --soak career --base main --head HEAD --out tools/dev/scratch/ab
 *
 * Soaks: career, quick, fairness, tailhold, defence, raid. --set selects the existing
 * fairness/tailhold/raid sets; for defence it selects DEFENCE_AB modes (default mix).
 * --reps sets the count (defence seeds); tailhold defaults to 36, fairness to 48,
 * raid to 12, quick/defence to 24. --missions sets career missions per pilot (10).
 * --env, --a and --b are repeatable KEY=VALUE entries, split only at the first '='.
 * Commas belong to the value, never separate variables: migrate --env X=1,Y=2 to
 * --env X=1 --env Y=2. Single entries remain unchanged; there is no legacy comma shim.
 * --flag appends f=0/f=1 to each variant's effective AI_TACTICS, retaining other flags.
 * Defence modes overwrite the three defence flags; select --a/--b DEFENCE_AB instead.
 * --base/--head run A/B in frozen scratch worktrees sharing this tree's node_modules.
 * Without them each side uses this working tree; do not edit it while a survey runs.
 * --jobs caps child processes (half the cores, at most 6); use --jobs 1 under load.
 * Raw reports, stdout, stderr and run inputs/exits are always retained in --out or a
 * printed temporary directory. Failed/incomplete surveys never emit a comparison.
 * Career/quick and fairness retain the existing interval-overlap heuristic, not a
 * paired significance test. New survey aggregates are descriptive, without verdicts.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, existsSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { summarizeComparison } from './ab-surveys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOAKS = ['career', 'quick', 'fairness', 'tailhold', 'defence', 'raid'];
const DEFENCE_MODES = ['off', 'brake', 'ladder', 'mix'];
const DEFENCE_FLAGS = ['escalateDefence', 'defenceLadder', 'defenceReversal'];
const SETS = {
  fairness: ['default', 'vet', 'even', 'dvii', 'dviiground', 'dviitypes', 'twoseat', 'mirror', 'matrix', 'camel', 'energy', 'survey'],
  tailhold: ['default', 'mirror', 'energy', 'low'],
  raid: ['default', 'escort'],
  defence: DEFENCE_MODES,
};
// Record only actual survey inputs from the ambient environment, not credentials or machine secrets.
const SURVEY_ENV = [
  'AI_TACTICS', 'AUTOPLAY_PILOT', 'AUTOPLAY_HUMAN', 'AUTOPLAY_MAXTIME', 'AUTOPLAY_DIFFICULTY',
  'AUTOPLAY_QUICK_SETUPS', 'AUTOPLAY_QUICK_TYPES', 'AUTOPLAY_QUICK_BY_SETUP',
  'AI_FAIR_SKILL', 'AI_FAIR_ONLY', 'AI_TH_MAXTIME', 'DEFENCE_TRACE', 'SIM_DAMAGE_PATH',
];
const fail = (message) => { throw new Error(message); };
const posInt = (name, value) => {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`--${name} must be a positive safe integer, got ${JSON.stringify(value)}`);
  return Number(value);
};
const envEntries = (entries = []) => {
  const result = new Map();
  for (const entry of entries) {
    const i = entry.indexOf('=');
    const key = entry.slice(0, i);
    if (i < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(`expected KEY=VALUE, got ${JSON.stringify(entry)}`);
    if (result.has(key)) fail(`duplicate environment key ${key}; supply one value per variant`);
    const value = entry.slice(i + 1);
    // Known survey variable assignments are not tactic flags or JSON; catch the old syntax.
    if (/,(?:AI_|AUTOPLAY_|DEFENCE_)[A-Z0-9_]*=/.test(value)) fail(`ambiguous comma-separated environment entries in ${key}; repeat --env/--a/--b KEY=VALUE instead`);
    result.set(key, value);
  }
  return Object.fromEntries(result);
};
const validateSet = (soak, set) => {
  if (!SETS[soak]) return;
  const names = set.split(',');
  if (new Set(names).size !== names.length) fail(`duplicate ${soak} set/mode in ${set}`);
  for (const name of names) if (!SETS[soak].includes(name)) fail(`unknown ${soak} set/mode ${JSON.stringify(name)}; use ${SETS[soak].join(', ')}`);
};

/** Parse the CLI's actual environment transport and cohort selection, without launching soaks. */
export function parseOptions(args) {
  const { values: o } = parseArgs({ args, options: {
    soak: { type: 'string' }, flag: { type: 'string' },
    a: { type: 'string', multiple: true }, b: { type: 'string', multiple: true }, env: { type: 'string', multiple: true },
    base: { type: 'string' }, head: { type: 'string' }, out: { type: 'string' },
    seeds: { type: 'string', default: '0,1000,2000' }, missions: { type: 'string', default: '10' },
    reps: { type: 'string' }, set: { type: 'string' }, jobs: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (o.help) return o;
  if (!SOAKS.includes(o.soak)) fail(`--soak must be one of ${SOAKS.join(', ')}`);
  const common = envEntries(o.env), A = envEntries(o.a), B = envEntries(o.b);
  if (!o.flag && !o.a?.length && !o.b?.length && !o.base && !o.head) fail('give --flag, --a/--b, --base or --head');
  if (o.flag) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(o.flag)) fail('invalid tactic flag name');
    if (o.soak === 'defence' && DEFENCE_FLAGS.includes(o.flag)) fail(`DEFENCE_AB overwrites --flag ${o.flag}; use --a DEFENCE_AB=off --b DEFENCE_AB=mix (or brake/ladder)`);
    for (const [variant, value] of [[A, 0], [B, 1]]) {
      variant.AI_TACTICS = [variant.AI_TACTICS ?? common.AI_TACTICS ?? process.env.AI_TACTICS, `${o.flag}=${value}`].filter(Boolean).join(',');
    }
  }
  const set = o.set ?? (o.soak === 'defence' ? 'mix' : 'default');
  validateSet(o.soak, set);
  if (o.soak === 'defence') {
    for (const variant of [A, B]) {
      variant.DEFENCE_AB = variant.DEFENCE_AB ?? common.DEFENCE_AB ?? o.set ?? process.env.DEFENCE_AB ?? set;
      validateSet('defence', variant.DEFENCE_AB);
      const tactics = variant.AI_TACTICS ?? common.AI_TACTICS ?? process.env.AI_TACTICS ?? '';
      if (tactics.split(',').some((kv) => DEFENCE_FLAGS.includes(kv.split('=')[0]))) fail('DEFENCE_AB overwrites configured defence AI_TACTICS; compare DEFENCE_AB modes instead');
    }
  }
  const seeds = o.soak === 'career' ? o.seeds.split(',').map((s) => {
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) fail(`bad seed ${JSON.stringify(s)}`);
    return s;
  }) : ['-'];
  if (new Set(seeds).size !== seeds.length) fail('duplicate career seed');
  return { ...o, A, B, common, set, seeds,
    jobs: o.jobs ? posInt('jobs', o.jobs) : Math.max(1, Math.min(6, Math.floor(cpus().length / 2))),
    reps: o.reps ? posInt('reps', o.reps) : ({ fairness: 48, tailhold: 36, raid: 12 }[o.soak] ?? 24),
    missions: posInt('missions', o.missions),
  };
}

function frozenTree(ref, trees) {
  const dir = mkdtempSync(join(tmpdir(), 'rb2r-ab-'));
  execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', dir, ref], { stdio: 'pipe' });
  trees.push(dir); // Track before linking: a setup failure must still remove this scratch tree.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function soakJob(o, cwd, variant, seed, outputDir) {
  const tag = `${variant}-seed${seed}`;
  const out = join(outputDir, `${tag}.report.txt`);
  const inherited = Object.fromEntries(SURVEY_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  const overrides = { ...inherited, ...o.common, ...o[variant] };
  let file;
  if (o.soak === 'career' || o.soak === 'quick') {
    Object.assign(overrides, { AUTOPLAY: o.soak, AUTOPLAY_OUT: out });
    if (o.soak === 'career') Object.assign(overrides, { AUTOPLAY_MISSIONS: String(o.missions), AUTOPLAY_SEED_BASE: seed });
    else overrides.AUTOPLAY_QUICK_REPS = String(o.reps);
    file = 'src/game/autoplay.soak.test.ts';
  } else if (o.soak === 'defence') {
    Object.assign(overrides, { DEFENCE_SEEDS: String(o.reps) });
    file = 'src/ai/defence.realsim.test.ts';
  } else {
    const prefix = { fairness: 'AI_FAIR', tailhold: 'AI_TH', raid: 'AI_RAID' }[o.soak];
    Object.assign(overrides, { AI_SOAK: o.soak, [`${prefix}_SET`]: o.set, [`${prefix}_REPS`]: String(o.reps) });
    file = `src/ai/${o.soak}.soak.test.ts`;
  }
  return { cwd, variant, seed, tag, file, out, overrides };
}

function run(job) {
  return new Promise((done) => {
    const vitest = join(job.cwd, 'node_modules/.bin/vitest');
    const child = spawn(vitest, ['run', job.file], { cwd: job.cwd, env: { ...process.env, ...job.overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { error = err.message; });
    child.on('close', (code, signal) => {
      let text = stdout;
      if (job.file === 'src/game/autoplay.soak.test.ts') text = existsSync(job.out) ? readFileSync(job.out, 'utf8') : '';
      process.stderr.write(`ab: ${job.tag} exited ${code ?? signal ?? error}\n`);
      done({ ...job, text, stdout, stderr, code, signal, error });
    });
  });
}

async function pool(list, jobs) {
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await run(list[index]);
    }
  }));
  return results;
}

async function main(o) {
  const outputDir = o.out ? resolve(o.out) : mkdtempSync(join(tmpdir(), 'rb2r-ab-out-'));
  mkdirSync(outputDir, { recursive: true });
  if (existsSync(join(outputDir, 'runs.json'))) fail(`output directory already contains runs.json: ${outputDir}; choose a new --out directory`);
  process.stderr.write(`ab: raw evidence in ${outputDir}\n`);
  const trees = [];
  try {
    const commitOf = (ref) => execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
    const aCommit = o.base ? commitOf(o.base) : null;
    const bCommit = o.head ? commitOf(o.head) : null;
    const aCwd = aCommit ? frozenTree(aCommit, trees) : ROOT;
    const bCwd = bCommit ? frozenTree(bCommit, trees) : ROOT;
    const list = o.seeds.flatMap((s) => [soakJob(o, aCwd, 'A', s, outputDir), soakJob(o, bCwd, 'B', s, outputDir)]);
    for (const job of list) for (const suffix of ['.txt', '.report.txt', '.stdout.txt', '.stderr.txt']) {
      if (existsSync(join(outputDir, `${job.tag}${suffix}`))) fail(`raw evidence already exists for ${job.tag}; choose a new --out directory`);
    }
    const roots = { A: { cwd: aCwd, ref: o.base ?? null, head: execFileSync('git', ['-C', aCwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
      B: { cwd: bCwd, ref: o.head ?? null, head: execFileSync('git', ['-C', bCwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } };
    const record = (results) => writeFileSync(join(outputDir, 'runs.json'), JSON.stringify({ soak: o.soak, set: o.set, reps: o.reps,
      missions: o.missions, seeds: o.seeds, roots, runs: results.map(({ stdout, stderr, text, ...r }) => r) }, null, 2) + '\n');
    record(list);
    process.stderr.write(`ab: ${list.length} runs, ${o.jobs} at a time\n`);
    const results = await pool(list, o.jobs);
    for (const r of results) {
      writeFileSync(join(outputDir, `${r.tag}.txt`), r.text);
      writeFileSync(join(outputDir, `${r.tag}.stdout.txt`), r.stdout);
      writeFileSync(join(outputDir, `${r.tag}.stderr.txt`), r.stderr);
    }
    record(results);
    const summary = summarizeComparison(o.soak, results, { reps: o.reps });
    const label = (variant) => `${o[variant === 'A' ? 'base' : 'head'] ?? 'this tree'}; ${Object.entries(o[variant]).map(([k, v]) => `${k}=${v}`).join(', ') || 'default environment'}`;
    const lines = [`A/B ${o.soak}${o.soak === 'career' ? ` (seeds ${o.seeds.join(' ')}; ${o.missions} missions a pilot)` : ` (${o.reps} reps; set ${o.set})`}`,
      `  A: ${label('A')}`, `  B: ${label('B')}`, `  raw evidence: ${outputDir}`];
    if (Object.keys(o.common).length) lines.push(`  both: ${Object.entries(o.common).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    lines.push(summary);
    if (o.soak === 'career' && (o.base || o.head)) lines.push('note: career bases before the deterministic posting fix (F-33) are not comparable; no compatibility patch is applied');
    const report = lines.join('\n') + '\n';
    writeFileSync(join(outputDir, 'summary.txt'), report);
    process.stdout.write(report);
  } finally {
    for (const tree of trees) execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', tree], { stdio: 'pipe' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseOptions(process.argv.slice(2));
    if (o.help) process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0] + '*/\n');
    else await main(o);
  } catch (error) {
    process.stderr.write(`ab: ${error.message}\n(run with --help for usage)\n`);
    process.exitCode = 2;
  }
}
