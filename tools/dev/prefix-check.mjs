#!/usr/bin/env node
// The TDD "fails first" step (F-75): run your working-tree test files against HEAD's sources
// and confirm they fail there. A detached scratch worktree at HEAD receives copies of the named
// test files; the named source files (your fix) stay at HEAD. Then `sfw pnpm install
// --frozen-lockfile` and `pnpm exec vitest run <tests>`.
//
//   pnpm exec node tools/dev/prefix-check.mjs <test-file…> -- <source-file…>
//
// Progress and failure excerpts go to stderr; a JSON report goes to stdout. Logs are kept under
// tools/dev/scratch/prefix-check/<run>/ (git-ignored); nothing else in your checkout changes.
// Exit 0 when the tests fail at HEAD on test failures (the desired red), 1 when they pass at
// HEAD (not red), 2 on usage or setup errors and inconclusive runs (a test file that failed to
// load, e.g. importing a module HEAD lacks), 130/143 when interrupted.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isolatedEnv, run, stopAll, withScratchWorktree } from './scratch-worktree.mjs';

const EXCERPT_LINES = 30;

for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
  delete process.env[key];
}

const say = (line) => process.stderr.write(`${line}\n`);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

function usage(code, message) {
  if (message) say(`prefix-check: ${message}`);
  say('Usage: pnpm exec node tools/dev/prefix-check.mjs <test-file…> -- <source-file…>');
  process.exit(code);
}

/** Repo-relative POSIX path of `file` (given relative to the caller's cwd), or a usage error. */
function repoPath(root, file) {
  if (!file || file.startsWith('-')) usage(2, `not a file path: ${JSON.stringify(file)}`);
  const rel = relative(root, resolve(process.cwd(), file));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) usage(2, `${file} is outside the repository`);
  return rel.split('\\').join('/');
}

const atHead = (root, rel) => { try { git(root, 'cat-file', '-e', `HEAD:${rel}`); return true; } catch { return false; } };

/** Whether the working-tree `rel` differs from HEAD's (added, changed or deleted). */
function differsFromHead(root, rel) {
  const exists = existsSync(join(root, rel));
  if (!atHead(root, rel)) return exists;
  if (!exists) return true;
  return git(root, 'hash-object', '--', rel) !== git(root, 'rev-parse', `HEAD:${rel}`);
}

/**
 * Classify a Vitest JSON report: 'red' (at least one assertion failed, every named file
 * loaded), 'passed' (nothing failed), or 'inconclusive' with a reason.
 */
export function classify(report, tests, directory, exitCode) {
  if (!report) return { verdict: 'inconclusive', reason: 'Vitest wrote no JSON report', files: [] };
  // Vitest reports real paths; the temp directory may sit behind a symlink (macOS /var).
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  const top = real(directory);
  const files = (report.testResults ?? []).map((file) => {
    const assertions = file.assertionResults ?? [];
    const failed = assertions.filter((a) => a.status === 'failed');
    const loadError = file.status === 'failed' && (file.message || !assertions.length);
    return {
      file: relative(top, real(file.name)).split('\\').join('/'),
      status: loadError ? 'load-error' : failed.length ? 'failed' : 'passed',
      message: loadError ? (file.message || 'failed with no test results') : undefined,
      failed: failed.map((a) => a.fullName ?? a.title),
      passed: assertions.filter((a) => a.status === 'passed').length,
    };
  });
  const missing = tests.filter((t) => !files.some((f) => f.file === t));
  if (missing.length) return { verdict: 'inconclusive', reason: `Vitest did not run ${missing.join(', ')} (outside its include patterns?)`, files };
  const broken = files.filter((f) => f.status === 'load-error');
  if (broken.length) {
    return { verdict: 'inconclusive', files,
      reason: `${broken.map((f) => f.file).join(', ')} failed to load at HEAD, so no assertion ran there (a missing export? add a stub first)` };
  }
  if (files.some((f) => f.status === 'failed')) return { verdict: 'red', files };
  if (exitCode !== 0) return { verdict: 'inconclusive', reason: `Vitest exited ${exitCode} with no failed test (unhandled error?)`, files };
  return { verdict: 'passed', files };
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) usage(0);
  const split = args.indexOf('--');
  if (split < 0) usage(2, 'separate the test files from the source files with --');
  let root;
  try { root = git(process.cwd(), 'rev-parse', '--show-toplevel'); } catch { usage(2, 'not inside a Git repository'); }
  const tests = args.slice(0, split).map((f) => repoPath(root, f));
  const sources = args.slice(split + 1).map((f) => repoPath(root, f));
  if (!tests.length) usage(2, 'give at least one test file before --');
  if (!sources.length) usage(2, 'give at least one source file after --');
  for (const t of tests) {
    if (!existsSync(join(root, t)) || !statSync(join(root, t)).isFile()) usage(2, `test file ${t} does not exist`);
    if (sources.includes(t)) usage(2, `${t} is named as both a test and a source`);
  }
  for (const s of sources) if (!existsSync(join(root, s)) && !atHead(root, s)) usage(2, `source file ${s} exists neither in the working tree nor at HEAD`);
  const head = git(root, 'rev-parse', 'HEAD');
  const changedSources = sources.filter((s) => differsFromHead(root, s));
  if (!changedSources.length) say('prefix-check: warning: no named source differs from HEAD, so a red here does not show your fix turns it green');

  const logs = join(root, 'tools/dev/scratch/prefix-check', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(logs, { recursive: true });
  let interrupted = null;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted ??= signal; stopAll(signal); });

  const env = isolatedEnv(root);
  const result = { head, tests, sources, changedSources, verdict: 'not-run', reason: null, files: [], logs, cleanup: null };
  say(`prefix-check: ${tests.length} test file(s) against HEAD ${head.slice(0, 10)}`);
  try {
    const { cleanup } = await withScratchWorktree({ root, commit: head, prefix: 'rb2r-prefix-check-' }, async ({ directory }) => {
      for (const t of tests) {
        await mkdir(dirname(join(directory, t)), { recursive: true });
        await copyFile(join(root, t), join(directory, t));
      }
      const steps = [
        ['install', 'sfw', ['pnpm', 'install', '--frozen-lockfile']],
        ['vitest', 'pnpm', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json',
          `--outputFile.json=${join(directory, '..', 'vitest.json')}`, ...tests]],
      ];
      for (const [name, command, commandArgs] of steps) {
        if (interrupted) return;
        say(`  ${name} ...`);
        const log = join(logs, `${name}.log`);
        const outcome = await run(command, commandArgs, { cwd: directory, env, logFile: log });
        if (interrupted) return;
        if (name === 'install' && outcome.code !== 0) {
          result.verdict = 'inconclusive';
          result.reason = `install failed (${outcome.error ?? `exit ${outcome.code}`}); log: ${log}`;
          say((outcome.error ?? outcome.output).trimEnd().split('\n').slice(-EXCERPT_LINES).map((l) => `    | ${l}`).join('\n'));
          return;
        }
        if (name === 'vitest') {
          let report = null;
          try { report = JSON.parse(await readFile(join(directory, '..', 'vitest.json'), 'utf8')); } catch { /* none */ }
          Object.assign(result, classify(report, tests, directory, outcome.code), { log });
          if (result.verdict !== 'passed') {
            say(outcome.output.trimEnd().split('\n').slice(-EXCERPT_LINES).map((l) => `    | ${l}`).join('\n'));
          }
        }
      }
    });
    result.cleanup = cleanup;
  } catch (error) {
    result.verdict = 'inconclusive';
    result.reason = `setup failed: ${error.message}`;
    result.cleanup = error.cleanup ?? 'unknown';
  }
  if (interrupted) { result.verdict = 'interrupted'; result.reason = `interrupted by ${interrupted}`; }
  if (result.cleanup && result.cleanup !== 'removed') say(`  cleanup: ${result.cleanup}`);

  const text = {
    red: 'RED at HEAD: the tests fail on test failures without your sources (good)',
    passed: 'NOT RED: the tests pass at HEAD, so they do not prove the fix',
    inconclusive: `INCONCLUSIVE: ${result.reason}`,
    interrupted: `INTERRUPTED (${interrupted})`,
  }[result.verdict];
  say(`prefix-check: ${text}`);
  for (const f of result.files) say(`  ${f.status.padEnd(10)} ${f.file}${f.failed.length ? `: ${f.failed.join('; ')}` : ''}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143
    : result.verdict === 'red' ? 0 : result.verdict === 'passed' ? 1 : 2;
}

if (import.meta.main) await main(process.argv.slice(2));
