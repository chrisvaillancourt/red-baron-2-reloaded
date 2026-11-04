import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./prefix-check.mjs', import.meta.url));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', ...args],
    { encoding: 'utf8' });
}

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Fake `sfw` and `pnpm`. `pnpm exec vitest run … <tests>` reads each test file in the scratch
// tree and acts on its first line, then writes a Vitest-shaped JSON report:
//   pass               one passing test
//   fail-unless-fixed  fails unless src/fix.ts (at whatever version the tree has) says "fixed"
//   load-error         the file fails to load (no assertions)
//   hang               background child holding the pipe, then wait (for Ctrl-C)
// FAKE_INSTALL_FAIL=1 makes the install fail; every call is appended to $FAKE_LOG.
const FAKE = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'install') process.exit(process.env.FAKE_INSTALL_FAIL ? 1 : 0);
const out = args.find((a) => a.startsWith('--outputFile.json=')).split('=')[1];
const tests = args.slice(3).filter((a) => !a.startsWith('-'));
const results = [];
let failed = 0;
for (const t of tests) {
  const mode = readFileSync(t, 'utf8').split('\\n')[0].trim();
  const name = join(process.cwd(), t);
  if (mode === 'hang') {
    const child = spawn('sleep', ['300'], { stdio: ['ignore', 'inherit', 'inherit'] });
    writeFileSync(process.env.FAKE_CHILD_PID, String(child.pid));
    console.log('fake vitest hanging');
    await new Promise(() => {});
  }
  if (mode === 'load-error') { failed++; results.push({ name, status: 'failed', message: "Cannot find module './new'", assertionResults: [] }); continue; }
  const ok = mode === 'pass' || readFileSync('src/fix.ts', 'utf8').includes('fixed');
  if (!ok) failed++;
  results.push({ name, status: ok ? 'passed' : 'failed', message: '',
    assertionResults: [{ fullName: t + ' check', status: ok ? 'passed' : 'failed', failureMessages: ok ? [] : ['AssertionError: nope'] }] });
}
writeFileSync(out, JSON.stringify({ numFailedTests: failed, testResults: results }));
console.log(failed ? 'fake vitest: failed' : 'fake vitest: passed');
process.exit(failed ? 1 : 0);
`;

async function fakeBin(t) {
  const bin = await tempDir(t, 'rb2r-prefix-check-bin-');
  await writeFile(join(bin, 'fake.mjs'), FAKE);
  await writeFile(join(bin, 'sfw'), '#!/bin/sh\nexec "$@"\n');
  await writeFile(join(bin, 'pnpm'), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'fake.mjs')}" "$@"\n`);
  await chmod(join(bin, 'sfw'), 0o755);
  await chmod(join(bin, 'pnpm'), 0o755);
  return bin;
}

/** A repo whose HEAD has src/fix.ts = "old" and the given committed files. */
async function fixture(t, files = {}) {
  const root = await tempDir(t, 'rb2r-prefix-check-repo-');
  git(root, 'init', '-q');
  const all = { '.gitignore': 'tools/dev/scratch/\nnode_modules/\n', 'src/fix.ts': 'old\n', ...files };
  for (const [p, body] of Object.entries(all)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  return root;
}

async function put(root, p, body) {
  await mkdir(dirname(join(root, p)), { recursive: true });
  await writeFile(join(root, p), body);
}

async function runCli(t, root, bin, args, { env = {}, onStderr } = {}) {
  const tmp = await tempDir(t, 'rb2r-prefix-check-tmp-');
  const fakeLog = join(await tempDir(t, 'rb2r-prefix-check-log-'), 'calls.jsonl');
  await writeFile(fakeLog, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: root, env: { ...process.env, TMPDIR: tmp, FAKE_LOG: fakeLog, PATH: `${bin}:${process.env.PATH}`, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; onStderr?.(stderr, child); });
    child.on('close', async (code) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* not JSON */ }
      const calls = (await readFile(fakeLog, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
      resolve({ code, stdout, stderr, report, calls, leftovers: await readdir(tmp) });
    });
  });
}

const registered = (root) => git(root, 'worktree', 'list', '--porcelain')
  .split('\n').filter((line) => line.startsWith('worktree ')).length;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('red: a new test fails against HEAD sources while the fixed source stays in the caller tree', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/fix.ts', 'fixed\n');
  await put(root, 'src/fix.test.ts', 'fail-unless-fixed\n');
  const snapshot = () => ({ status: git(root, 'status', '--porcelain', '--untracked-files=all', '--ignored=no'),
    index: git(root, 'ls-files', '--stage'), refs: git(root, 'show-ref'), trees: registered(root) });
  const before = snapshot();

  const { code, report, stderr, calls, leftovers } = await runCli(t, root, bin, ['src/fix.test.ts', '--', 'src/fix.ts']);

  assert.equal(code, 0, stderr);
  assert.equal(report.verdict, 'red');
  assert.deepEqual(report.changedSources, ['src/fix.ts']);
  assert.deepEqual(report.files.map((f) => [f.file, f.status]), [['src/fix.test.ts', 'failed']]);
  assert.equal(report.cleanup, 'removed');
  assert.deepEqual(calls[0], ['install', '--frozen-lockfile']);
  assert.deepEqual(calls[1].slice(0, 2), ['exec', 'vitest']);
  assert.equal(calls[1].at(-1), 'src/fix.test.ts');
  assert.match(stderr, /RED at HEAD/);
  assert.deepEqual(snapshot(), before);
  assert.equal(await readFile(join(root, 'src/fix.ts'), 'utf8'), 'fixed\n');
  assert.deepEqual(leftovers, []);
});

test('not red: tests that pass at HEAD exit 1', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t, { 'src/a.test.ts': 'fail-unless-fixed\n' });
  await put(root, 'src/a.test.ts', 'pass\n'); // the caller's edited version is the one that runs
  await put(root, 'src/fix.ts', 'fixed\n');
  const { code, report } = await runCli(t, root, bin, ['src/a.test.ts', '--', 'src/fix.ts']);
  assert.equal(code, 1);
  assert.equal(report.verdict, 'passed');
});

test('a test file that fails to load at HEAD is inconclusive, not red', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/new.ts', 'fixed\n');
  await put(root, 'src/new.test.ts', 'load-error\n');
  await put(root, 'src/other.test.ts', 'fail-unless-fixed\n');
  const { code, report, stderr } = await runCli(t, root, bin, ['src/new.test.ts', 'src/other.test.ts', '--', 'src/new.ts']);
  assert.equal(code, 2, stderr);
  assert.equal(report.verdict, 'inconclusive');
  assert.match(report.reason, /src\/new\.test\.ts failed to load/);
  assert.equal(report.files.find((f) => f.file === 'src/new.test.ts').status, 'load-error');
});

test('an install failure is inconclusive and skips vitest', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/fix.test.ts', 'fail-unless-fixed\n');
  const { code, report, calls } = await runCli(t, root, bin, ['src/fix.test.ts', '--', 'src/fix.ts'], { env: { FAKE_INSTALL_FAIL: '1' } });
  assert.equal(code, 2);
  assert.match(report.reason, /install failed/);
  assert.equal(calls.length, 1);
  assert.equal(report.cleanup, 'removed');
});

test('warns when no named source differs from HEAD', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/fix.test.ts', 'fail-unless-fixed\n');
  const { code, stderr, report } = await runCli(t, root, bin, ['src/fix.test.ts', '--', 'src/fix.ts']);
  assert.equal(code, 0);
  assert.deepEqual(report.changedSources, []);
  assert.match(stderr, /no named source differs from HEAD/);
});

test('usage errors exit 2 before creating any worktree', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/fix.test.ts', 'pass\n');
  const outside = await tempDir(t, 'rb2r-prefix-check-outside-');
  for (const args of [[], ['src/fix.test.ts'], ['--', 'src/fix.ts'], ['src/fix.test.ts', '--'],
    ['src/missing.test.ts', '--', 'src/fix.ts'], ['src/fix.test.ts', '--', 'src/nowhere.ts'],
    ['src/fix.test.ts', '--', 'src/fix.test.ts'], [join(outside, 'x.test.ts'), '--', 'src/fix.ts']]) {
    const bad = await runCli(t, root, bin, args);
    assert.equal(bad.code, 2, `${JSON.stringify(args)}: ${bad.stderr}`);
    assert.equal(bad.calls.length, 0);
    assert.equal(registered(root), 1);
  }
});

test('Ctrl-C stops vitest and its children and removes the scratch tree', async (t) => {
  const bin = await fakeBin(t);
  const root = await fixture(t);
  await put(root, 'src/fix.test.ts', 'hang\n');
  const pidFile = join(await tempDir(t, 'rb2r-prefix-check-pid-'), 'child.pid');
  let sent = false;
  const { code, report, leftovers } = await runCli(t, root, bin, ['src/fix.test.ts', '--', 'src/fix.ts'], {
    env: { FAKE_CHILD_PID: pidFile },
    onStderr: (stderr, child) => {
      if (!sent && stderr.includes('vitest ...')) { sent = true; setTimeout(() => child.kill('SIGINT'), 500); }
    },
  });
  assert.equal(code, 130);
  assert.equal(report.verdict, 'interrupted');
  assert.equal(report.cleanup, 'removed');
  assert.equal(registered(root), 1);
  assert.deepEqual(leftovers, []);
  assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false);
});
