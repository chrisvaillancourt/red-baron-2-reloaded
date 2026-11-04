import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Fake `sfw` and `pnpm` on PATH. Each commit's `gates.txt` names what each gate does, so
// behaviour is per commit and independent of machine load:
//   fail-<gate>    exit 1
//   hang-<gate>    background child holding the output pipe, then wait (for Ctrl-C)
//   detach-<gate>  background child with its output redirected, then wait (for Ctrl-C)
//   linger-<gate>  background child holding the output pipe, then exit 0
//   tool-<gate>    run `fakelint`, which the commit itself does not provide
async function fakeBin(t) {
  const bin = await tempDir(t, 'rb2r-checkcommits-bin-');
  await writeFile(join(bin, 'sfw'), '#!/bin/sh\nexec "$@"\n');
  await writeFile(join(bin, 'pnpm'), `#!/bin/sh
gate="$1"; [ "$gate" = exec ] && gate="$2"
echo "fake pnpm $gate"
has() { grep -qx "$1-$gate" gates.txt 2>/dev/null; }
if has hang; then sleep 300 & echo $! > "$RB2R_CHILD_PID"; wait; fi
if has detach; then sleep 301 >/dev/null 2>&1 & echo $! > "$RB2R_CHILD_PID"; wait; fi
if has linger; then sleep 302 & echo $! > "$RB2R_CHILD_PID"; exit 0; fi
if has tool; then fakelint || exit 1; fi
if has fail; then echo "boom in $gate" >&2; exit 1; fi
exit 0
`);
  await chmod(join(bin, 'sfw'), 0o755);
  await chmod(join(bin, 'pnpm'), 0o755);
  return bin;
}

async function fixture(t, commits) {
  const root = await tempDir(t, 'rb2r-checkcommits-repo-');
  git(root, 'init', '-q');
  await writeFile(join(root, '.gitignore'), 'tools/dev/scratch/\nnode_modules/\n');
  const shas = [];
  for (const gates of commits) {
    await writeFile(join(root, 'gates.txt'), `${gates.join('\n')}\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '--allow-empty', '-qm', `gates ${gates.join(',') || 'pass'}`);
    shas.push(git(root, 'rev-parse', 'HEAD').trim());
  }
  return { root, shas };
}

// Each run gets its own TMPDIR, so concurrent checkcommits runs elsewhere can't interfere.
async function runCli(t, root, bin, args, { env = {}, pathPrefix = '', onStderr } = {}) {
  const tmp = await tempDir(t, 'rb2r-checkcommits-tmp-');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: root, env: { ...process.env, TMPDIR: tmp, PATH: `${pathPrefix}${bin}:${process.env.PATH}`, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; onStderr?.(stderr, child); });
    child.on('close', async (code, signal) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* not JSON */ }
      resolve({ code, signal, stdout, stderr, report, leftovers: await readdir(tmp) });
    });
  });
}

const registered = (root) => git(root, 'worktree', 'list', '--porcelain')
  .split('\n').filter((line) => line.startsWith('worktree ')).length;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const interruptAt = (marker) => {
  let sent = false;
  return (stderr, child) => {
    if (!sent && stderr.includes(marker)) {
      sent = true;
      setTimeout(() => child.kill('SIGINT'), 300); // let the fake gate start its child
    }
  };
};

test('reports each commit independently and leaves the caller checkout untouched', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[], ['fail-typecheck']]);
  await writeFile(join(root, 'gates.txt'), 'staged\n');
  git(root, 'add', 'gates.txt');
  await writeFile(join(root, 'gates.txt'), 'unstaged\n');
  await writeFile(join(root, 'untracked.txt'), 'caller data\n');
  const snapshot = () => ({ status: git(root, 'status', '--porcelain'), refs: git(root, 'show-ref'),
    index: git(root, 'ls-files', '--stage') + git(root, 'diff', '--cached'), trees: registered(root) });
  const before = snapshot();

  const { code, report, stderr, leftovers } = await runCli(t, root, bin, shas);

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

  assert.deepEqual(snapshot(), before);
  assert.equal(await readFile(join(root, 'gates.txt'), 'utf8'), 'unstaged\n');
  assert.deepEqual(leftovers, []);
});

test('runs the repo test script and passes when every gate passes', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[]]);
  const { code, report } = await runCli(t, root, bin, ['HEAD']);
  assert.equal(code, 0);
  assert.equal(report.status, 'passed');
  assert.equal(report.results[0].commit, shas[0]);
  assert.match(await readFile(report.results[0].gates.test.log, 'utf8'), /fake pnpm test/);
});

test('an install failure skips the remaining gates of that commit', async (t) => {
  const bin = await fakeBin(t);
  const { root } = await fixture(t, [['fail-install']]);
  const { code, report } = await runCli(t, root, bin, ['HEAD']);
  assert.equal(code, 1);
  const { gates } = report.results[0];
  assert.equal(gates.install.status, 'failed');
  assert.equal(gates.typecheck.status, 'not-run');
  assert.equal(gates.test.status, 'not-run');
});

test('expands ranges oldest first and rejects bad refs before creating any worktree', async (t) => {
  const bin = await fakeBin(t);
  const { root, shas } = await fixture(t, [[], [], ['fail-test']]);
  const ranged = await runCli(t, root, bin, [`${shas[0]}..HEAD`]);
  assert.deepEqual(ranged.report.results.map((r) => r.commit), shas.slice(1));
  assert.equal(ranged.report.results[1].status, 'failed');

  const trees = registered(root);
  for (const args of [[], ['missing-ref'], ['HEAD', '--help-me'], ['HEAD..HEAD']]) {
    const bad = await runCli(t, root, bin, args);
    assert.equal(bad.code, 2, `${JSON.stringify(args)}: ${bad.stderr}`);
    assert.equal(registered(root), trees);
  }
});

test('the same commit twice keeps a separate log per run', async (t) => {
  const bin = await fakeBin(t);
  await fixture(t, [[]]).then(async ({ root }) => {
    const { report } = await runCli(t, root, bin, ['HEAD', 'HEAD']);
    const [first, second] = report.results.map((r) => r.gates.test.log);
    assert.notEqual(first, second);
  });
});

test('gates cannot see tools from the caller checkout node_modules', async (t) => {
  const bin = await fakeBin(t);
  const { root } = await fixture(t, [['tool-test']]);
  // `pnpm exec` puts the caller's node_modules/.bin first on PATH; a later commit's devDependency
  // must not satisfy an earlier commit's script.
  const callerBin = join(root, 'node_modules/.bin');
  await mkdir(callerBin, { recursive: true });
  await writeFile(join(callerBin, 'fakelint'), '#!/bin/sh\necho caller fakelint ran\n');
  await chmod(join(callerBin, 'fakelint'), 0o755);
  const { code, report } = await runCli(t, root, bin, ['HEAD'], {
    pathPrefix: `${callerBin}:`, env: { npm_lifecycle_event: 'x', PNPM_SCRIPT_SRC_DIR: root, INIT_CWD: root },
  });
  assert.equal(code, 1);
  assert.equal(report.results[0].gates.test.status, 'failed');
  assert.doesNotMatch(await readFile(report.results[0].gates.test.log, 'utf8'), /caller fakelint ran/);
});

test('leaves other worktree registrations alone, including prunable ones', async (t) => {
  const bin = await fakeBin(t);
  const { root } = await fixture(t, [[]]);
  const elsewhere = await tempDir(t, 'rb2r-checkcommits-other-');
  git(root, 'worktree', 'add', '--detach', '--quiet', join(elsewhere, 'moved'), 'HEAD');
  await rename(join(elsewhere, 'moved'), join(elsewhere, 'gone'));
  const before = git(root, 'worktree', 'list', '--porcelain');
  assert.match(before, /prunable/);
  const { code } = await runCli(t, root, bin, ['HEAD']);
  assert.equal(code, 0);
  assert.equal(git(root, 'worktree', 'list', '--porcelain'), before);
});

for (const mode of ['hang', 'detach']) {
  test(`Ctrl-C stops the running gate and its ${mode === 'hang' ? 'pipe-holding' : 'detached'} children, skips the rest and removes the tree`, async (t) => {
    const bin = await fakeBin(t);
    const { root, shas } = await fixture(t, [[`${mode}-test`], []]);
    const pidFile = join(await tempDir(t, 'rb2r-checkcommits-pid-'), 'child.pid');
    const { code, report, leftovers } = await runCli(t, root, bin, shas, {
      env: { RB2R_CHILD_PID: pidFile }, onStderr: interruptAt('test ...'),
    });
    assert.equal(code, 130);
    assert.equal(report.interrupted, 'SIGINT');
    assert.equal(report.results[0].status, 'interrupted');
    assert.equal(report.results[0].cleanup, 'removed');
    assert.equal(report.results[1].status, 'not-run');
    assert.equal(registered(root), 1);
    assert.deepEqual(leftovers, []);
    assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false, 'background child of the gate was stopped');
  });
}

test('a gate that exits while its child still holds the output pipe does not hang the run', async (t) => {
  const bin = await fakeBin(t);
  const { root } = await fixture(t, [['linger-typecheck']]);
  const pidFile = join(await tempDir(t, 'rb2r-checkcommits-pid-'), 'child.pid');
  const { code, report } = await runCli(t, root, bin, ['HEAD'], { env: { RB2R_CHILD_PID: pidFile } });
  assert.equal(code, 0);
  assert.equal(report.results[0].gates.typecheck.status, 'passed');
  assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false, 'leftover child of the gate was stopped');
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
