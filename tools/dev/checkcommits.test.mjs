import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withScratchWorktree } from './scratch-worktree.mjs';

const CLI = fileURLToPath(new URL('./checkcommits.mjs', import.meta.url));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', ...args],
    { encoding: 'utf8' });
}

// Fake `sfw` and `pnpm` on PATH. Each commit's `gates.txt` names the gates that fail or hang,
// so behaviour is per commit and independent of machine load.
async function fakeBin(t) {
  const bin = await mkdtemp(join(tmpdir(), 'rb2r-checkcommits-bin-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await writeFile(join(bin, 'sfw'), '#!/bin/sh\nexec "$@"\n');
  await writeFile(join(bin, 'pnpm'), `#!/bin/sh
gate="$1"; [ "$gate" = exec ] && gate="$2"
echo "fake pnpm $gate"
if grep -qx "hang-$gate" gates.txt 2>/dev/null; then
  sleep 300 & echo $! > "$PNPM_CHILD_PID"
  wait
fi
if grep -qx "fail-$gate" gates.txt 2>/dev/null; then echo "boom in $gate" >&2; exit 1; fi
exit 0
`);
  await chmod(join(bin, 'sfw'), 0o755);
  await chmod(join(bin, 'pnpm'), 0o755);
  return bin;
}

async function fixture(t, commits) {
  const root = await mkdtemp(join(tmpdir(), 'rb2r-checkcommits-repo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  await writeFile(join(root, '.gitignore'), 'tools/dev/scratch/\n');
  const shas = [];
  for (const gates of commits) {
    await writeFile(join(root, 'gates.txt'), `${gates.join('\n')}\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '--allow-empty', '-qm', `gates ${gates.join(',') || 'pass'}`);
    shas.push(git(root, 'rev-parse', 'HEAD').trim());
  }
  return { root, shas };
}

function runCli(root, bin, args, { env = {}, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; onStderr?.(stderr, child); });
    child.on('close', (code, signal) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* not JSON */ }
      resolve({ code, signal, stdout, stderr, report });
    });
  });
}

const registered = (root) => git(root, 'worktree', 'list', '--porcelain')
  .split('\n').filter((line) => line.startsWith('worktree ')).length;
const leftoverScratch = async () => (await readdir(tmpdir())).filter((n) => n.startsWith('rb2r-checkcommits-tree-'));

test('reports each commit independently and leaves the caller checkout untouched', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[], ['fail-typecheck']]);
  await writeFile(join(root, 'gates.txt'), 'staged\n');
  git(root, 'add', 'gates.txt');
  await writeFile(join(root, 'gates.txt'), 'unstaged\n');
  await writeFile(join(root, 'untracked.txt'), 'caller data\n');
  const before = { status: git(root, 'status', '--porcelain'), refs: git(root, 'show-ref'),
    index: git(root, 'ls-files', '--stage') + git(root, 'diff', '--cached'), trees: registered(root) };
  const scratchBefore = await leftoverScratch();

  const { code, report, stderr } = await runCli(root, bin, shas);

  assert.equal(code, 1, stderr);
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.results.map((r) => r.commit), shas);
  const [good, bad] = report.results;
  assert.equal(good.status, 'passed');
  assert.deepEqual(Object.values(good.gates).map((g) => g.status), ['passed', 'passed', 'passed']);
  assert.equal(bad.status, 'failed');
  assert.equal(bad.gates.typecheck.status, 'failed');
  assert.equal(bad.gates.test.status, 'passed', 'a typecheck failure must not skip the test gate');
  assert.match(await readFile(bad.gates.typecheck.log, 'utf8'), /boom in typecheck/);
  assert.match(stderr, /boom in typecheck/, 'failing output is excerpted on stderr');
  for (const r of report.results) assert.equal(r.cleanup, 'removed');

  assert.equal(git(root, 'status', '--porcelain'), before.status);
  assert.equal(git(root, 'show-ref'), before.refs);
  assert.equal(git(root, 'ls-files', '--stage') + git(root, 'diff', '--cached'), before.index);
  assert.equal(await readFile(join(root, 'gates.txt'), 'utf8'), 'unstaged\n');
  assert.equal(registered(root), before.trees);
  assert.deepEqual(await leftoverScratch(), scratchBefore);
});

test('runs the repo test script and passes when every gate passes', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[]]);
  const { code, report } = await runCli(root, bin, ['HEAD']);
  assert.equal(code, 0);
  assert.equal(report.status, 'passed');
  assert.equal(report.results[0].commit, shas[0]);
  assert.match(await readFile(report.results[0].gates.test.log, 'utf8'), /fake pnpm test/);
});

test('an install failure skips the remaining gates of that commit', async (t) => {
  const bin = await fakeBin(t);
  const { root } = await fixture(t, [['fail-install']]);
  const { code, report } = await runCli(root, bin, ['HEAD']);
  assert.equal(code, 1);
  const { gates } = report.results[0];
  assert.equal(gates.install.status, 'failed');
  assert.equal(gates.typecheck.status, 'not-run');
  assert.equal(gates.test.status, 'not-run');
});

test('expands ranges oldest first and rejects bad refs before creating any worktree', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[], [], ['fail-test']]);
  const ranged = await runCli(root, bin, [`${shas[0]}..HEAD`]);
  assert.deepEqual(ranged.report.results.map((r) => r.commit), shas.slice(1));
  assert.equal(ranged.report.results[1].status, 'failed');

  const trees = registered(root);
  for (const args of [[], ['missing-ref'], ['HEAD', '--help-me'], ['HEAD..HEAD']]) {
    const bad = await runCli(root, bin, args);
    assert.equal(bad.code, 2, `${JSON.stringify(args)}: ${bad.stderr}`);
    assert.equal(registered(root), trees);
  }
});

test('Ctrl-C stops the running gate and its children, skips the rest and removes the tree', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [['hang-test'], []]);
  const pidDir = await mkdtemp(join(tmpdir(), 'rb2r-checkcommits-pid-'));
  t.after(() => rm(pidDir, { recursive: true, force: true }));
  const pidFile = join(pidDir, 'child.pid');
  let sent = false;
  const { code, report } = await runCli(root, bin, shas, {
    env: { PNPM_CHILD_PID: pidFile },
    onStderr: (stderr, child) => {
      if (!sent && stderr.includes('test ...')) {
        sent = true;
        // Give the fake gate time to start its background child.
        setTimeout(() => child.kill('SIGINT'), 300);
      }
    },
  });
  assert.equal(code, 130);
  assert.equal(report.interrupted, 'SIGINT');
  assert.equal(report.results[0].status, 'interrupted');
  assert.equal(report.results[0].cleanup, 'removed');
  assert.equal(report.results[1].status, 'not-run');
  assert.equal(registered(root), 1);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'background child of the gate was stopped');
});

test('withScratchWorktree uses the caller prefix and removes the tree when the action throws', async (t) => {
  const { root, shas } = await fixture(t, [[]]);
  let seen;
  await assert.rejects(withScratchWorktree({ root, commit: shas[0], prefix: 'rb2r-prefix-test-' }, async ({ directory }) => {
    seen = directory;
    assert.match(directory, /rb2r-prefix-test-/);
    assert.equal(await readFile(join(directory, 'gates.txt'), 'utf8'), '\n');
    await mkdir(join(directory, 'node_modules'));
    throw new Error('consumer failed');
  }), /consumer failed/);
  assert.ok(seen);
  assert.equal(registered(root), 1);
  assert.deepEqual((await readdir(tmpdir())).filter((n) => n.startsWith('rb2r-prefix-test-')), []);
});
