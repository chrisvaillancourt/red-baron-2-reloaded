#!/usr/bin/env node
// Prove each commit of a series passes on its own (F-44): for every commit, a fresh detached
// worktree runs `sfw pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`.
//
//   pnpm exec node tools/dev/checkcommits.mjs <commit|A..B>…
//
// Progress and failing-output excerpts go to stderr; a JSON report goes to stdout. Full gate
// logs are kept under tools/dev/scratch/checkcommits/<run>/. Exit 0 when every gate of every
// commit passed, 1 when any failed, 2 on bad arguments, 130/143 when interrupted.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedEnv, run, stopAll, withScratchWorktree } from './scratch-worktree.mjs';

const GATES = [
  ['install', 'sfw', ['pnpm', 'install', '--frozen-lockfile']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['test', 'pnpm', ['test']],
];
const EXCERPT_LINES = 30;

// A caller inside a Git hook can export these; they would redirect our git calls.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
  delete process.env[key];
}

const say = (line) => process.stderr.write(`${line}\n`);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

function usage(code, message) {
  if (message) say(`checkcommits: ${message}`);
  say('Usage: pnpm exec node tools/dev/checkcommits.mjs <commit|A..B>…');
  process.exit(code);
}

/** Resolve every argument to exact SHAs (ranges oldest first) before any worktree exists. */
function resolveCommits(root, refs) {
  const commits = [];
  for (const ref of refs) {
    if (!ref || ref.startsWith('-')) usage(2, `not a commit or range: ${JSON.stringify(ref)}`);
    try {
      if (ref.includes('..')) {
        const listed = git(root, 'rev-list', '--reverse', '--end-of-options', ref).split('\n').filter(Boolean);
        if (!listed.length) usage(2, `range ${ref} contains no commits`);
        commits.push(...listed);
      } else {
        commits.push(git(root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`));
      }
    } catch { usage(2, `cannot resolve ${JSON.stringify(ref)}`); }
  }
  return commits;
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) usage(0);
  if (!args.length) usage(2, 'give at least one commit or range');
  let root;
  try { root = git(process.cwd(), 'rev-parse', '--show-toplevel'); } catch { usage(2, 'not inside a Git repository'); }
  const commits = resolveCommits(root, args);
  const logs = join(root, 'tools/dev/scratch/checkcommits', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(logs, { recursive: true });

  let interrupted = null;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { interrupted ??= signal; stopAll(signal); });
  }

  const results = [];
  const env = isolatedEnv(root);
  for (const [index, commit] of commits.entries()) {
    const short = commit.slice(0, 10);
    const gates = Object.fromEntries(GATES.map(([name]) => [name, { status: 'not-run' }]));
    const result = { commit, subject: git(root, 'log', '-1', '--format=%s', commit), status: 'not-run', gates, cleanup: null };
    results.push(result);
    if (interrupted) continue;
    say(`checkcommits: ${short} ${result.subject}`);
    const { cleanup } = await withScratchWorktree({ root, commit, prefix: 'rb2r-checkcommits-tree-' }, async ({ directory }) => {
      for (const [name, command, commandArgs] of GATES) {
        if (interrupted) break;
        if (name !== 'install' && gates.install.status !== 'passed') break;
        say(`  ${name} ...`);
        const started = Date.now();
        const log = join(logs, `${index + 1}-${short}-${name}.log`);
        const outcome = await run(command, commandArgs, { cwd: directory, env, logFile: log });
        const status = interrupted ? 'interrupted' : outcome.code === 0 ? 'passed' : 'failed';
        gates[name] = { status, code: outcome.code, signal: outcome.signal, error: outcome.error,
          seconds: Math.round((Date.now() - started) / 100) / 10, log };
        say(`  ${name} ${status} (${gates[name].seconds}s)`);
        if (status === 'failed') {
          const lines = (outcome.error ?? outcome.output).trimEnd().split('\n').slice(-EXCERPT_LINES);
          say(lines.map((line) => `    | ${line}`).join('\n'));
          say(`    full log: ${log}`);
        }
      }
    }).catch((error) => {
      gates.setup = { status: interrupted ? 'interrupted' : 'failed', error: error.message };
      say(`  setup failed: ${error.message}`);
      return { cleanup: error.cleanup ?? 'unknown' };
    });
    result.cleanup = cleanup;
    const statuses = Object.values(gates).map((gate) => gate.status);
    result.status = statuses.includes('interrupted') || (interrupted && statuses.includes('not-run') && !statuses.includes('failed'))
      ? 'interrupted'
      : statuses.every((s) => s === 'passed') ? 'passed' : 'failed';
    if (cleanup !== 'removed') say(`  cleanup: ${cleanup}`);
  }

  const status = !interrupted && results.every((r) => r.status === 'passed') ? 'passed' : 'failed';
  say(`checkcommits: ${status}${interrupted ? ` (interrupted by ${interrupted})` : ''}`);
  for (const r of results) say(`  ${r.status.padEnd(11)} ${r.commit.slice(0, 10)} ${r.subject}`);
  process.stdout.write(`${JSON.stringify({ status, interrupted, logs, results }, null, 2)}\n`);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : status === 'passed' ? 0 : 1;
}

await main(process.argv.slice(2));
