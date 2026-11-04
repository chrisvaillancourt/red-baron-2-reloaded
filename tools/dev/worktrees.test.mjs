import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseStatus } from './worktrees.mjs';

const CLI = fileURLToPath(new URL('./worktrees.mjs', import.meta.url));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', ...args],
    { encoding: 'utf8' }).trim();
}

async function tempDir(t, prefix, parent = tmpdir()) {
  const dir = realpathSync(await mkdtemp(join(parent, prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function runCli(cwd, args, tmp) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: tmp },
  });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* not JSON */ }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

/**
 * A repo with origin/main, plus worktrees in every interesting state. `tmp` is the per-run
 * TMPDIR handed to the CLI; only the `scratch` worktree lives inside it.
 */
async function fixture(t) {
  const home = await tempDir(t, 'rb2r-worktrees-home-');
  const tmp = await tempDir(t, 'rb2r-worktrees-tmp-');
  const root = join(home, 'main');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  await writeFile(join(root, 'a.txt'), 'a\n');
  await writeFile(join(root, 'b.txt'), 'b\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const wt = (name, ...args) => { const p = join(home, name); git(root, 'worktree', 'add', '-q', ...args, p, 'HEAD'); return p; };

  const paths = {
    root,
    merged: wt('merged', '-b', 'merged'),
    ahead: wt('ahead', '-b', 'ahead'),
    dirty: wt('dirty', '-b', 'dirty'),
    merging: wt('merging', '-b', 'merging'),
    detached: wt('detached', '--detach'),
    locked: wt('locked', '-b', 'locked'),
    gone: wt('gone', '-b', 'gone'),
    scratch: join(tmp, 'scratch'),
  };
  git(root, 'worktree', 'add', '-q', '--detach', paths.scratch, 'HEAD');
  await writeFile(join(paths.ahead, 'a.txt'), 'ahead\n');
  git(paths.ahead, 'commit', '-qam', 'ahead 1');
  await writeFile(join(paths.ahead, 'a.txt'), 'ahead 2\n');
  git(paths.ahead, 'commit', '-qam', 'ahead 2');
  await writeFile(join(paths.dirty, 'a.txt'), 'changed\n');
  await writeFile(join(paths.dirty, 'b.txt'), 'staged\n');
  git(paths.dirty, 'add', 'b.txt');
  await writeFile(join(paths.dirty, 'new1.txt'), 'u\n');
  await writeFile(join(paths.dirty, 'new2.txt'), 'u\n');
  const mergeHead = git(paths.merging, 'rev-parse', '--git-path', 'MERGE_HEAD');
  await writeFile(isAbsolute(mergeHead) ? mergeHead : resolve(paths.merging, mergeHead), `${git(root, 'rev-parse', 'HEAD')}\n`);
  git(root, 'worktree', 'lock', paths.locked);
  await rename(paths.gone, join(home, 'gone-moved'));
  return { root, tmp, paths };
}

const byPath = (report) => Object.fromEntries(report.worktrees.map((w) => [w.path, w]));

test('reports each worktree state and names only merged, clean, unlocked, non-main candidates', async (t) => {
  const { root, tmp, paths } = await fixture(t);
  // The snapshot's own status must not refresh the index it is watching.
  const index = join(git(paths.dirty, 'rev-parse', '--absolute-git-dir'), 'index');
  const snapshot = async () => ({
    index: (await stat(index)).mtimeMs,
    list: git(root, 'worktree', 'list', '--porcelain'),
    dirty: execFileSync('git', ['-C', paths.dirty, 'status', '--porcelain'],
      { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim(),
    mergeHead: await readFile(resolve(paths.merging, git(paths.merging, 'rev-parse', '--git-path', 'MERGE_HEAD')), 'utf8'),
  });
  const before = await snapshot();

  const { code, report, stderr } = await runCli(paths.dirty, ['--json'], tmp);
  assert.equal(code, 0, stderr);
  const rows = byPath(report);
  assert.equal(report.worktrees.length, 9);
  assert.equal(rows[root].main, true);
  assert.equal(rows[root].merged, true);

  assert.deepEqual(
    (({ branch, merged, dirty, untracked, staged, mergeHead, ahead, prunable, underTmp }) =>
      ({ branch, merged, dirty, untracked, staged, mergeHead, ahead, prunable, underTmp }))(rows[paths.merged]),
    { branch: 'merged', merged: true, dirty: 0, untracked: 0, staged: false, mergeHead: false, ahead: 0, prunable: false, underTmp: false });
  assert.equal(rows[paths.ahead].merged, false);
  assert.equal(rows[paths.ahead].ahead, 2);
  assert.match(rows[paths.ahead].lastCommit, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual([rows[paths.dirty].dirty, rows[paths.dirty].untracked, rows[paths.dirty].staged], [2, 2, true]);
  assert.equal(rows[paths.merging].mergeHead, true);
  assert.equal(rows[paths.detached].branch, null);
  assert.equal(rows[paths.detached].detached, true);
  assert.equal(rows[paths.locked].locked, true);
  assert.equal(rows[paths.gone].prunable, true);
  assert.equal(rows[paths.scratch].underTmp, true);

  assert.deepEqual(report.candidates.sort(), [paths.merged, paths.detached, paths.scratch].sort());
  assert.deepEqual(report.prunable, [paths.gone]);
  assert.deepEqual(await snapshot(), before, 'the inventory changed nothing');
});

test('the table ends with the candidate summary and says nothing was removed', async (t) => {
  const { root, tmp, paths } = await fixture(t);
  const { code, stdout } = await runCli(root, [], tmp);
  assert.equal(code, 0);
  assert.match(stdout, /^path\s+branch\s+merged/);
  assert.match(stdout, /\(detached [0-9a-f]{10}\)/);
  assert.match(stdout, /Nothing was removed/);
  assert.match(stdout, /Look safe to remove .*: 3\n/);
  assert.match(stdout, new RegExp(`Prunable .*: 1\\n  ${paths.gone}`));
  assert.equal(git(root, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 9);
});

test('--base changes the merge target; bad arguments exit 2', async (t) => {
  const { root, tmp, paths } = await fixture(t);
  const { report } = await runCli(root, ['--json', '--base', 'ahead'], tmp);
  assert.equal(byPath(report)[paths.ahead].merged, true);
  assert.equal(byPath(report)[paths.ahead].ahead, 0);
  for (const args of [['--base'], ['--base', 'no-such-ref'], ['--bogus']]) {
    assert.equal(runCli(root, args, tmp).code, 2, JSON.stringify(args));
  }
});

test('parseStatus counts renames once and ignores ignored entries', () => {
  assert.deepEqual(parseStatus('R  new.txt\0old.txt\0 M a.txt\0?? u.txt\0!! ig\0'), { dirty: 2, untracked: 1, staged: true });
  assert.deepEqual(parseStatus(''), { dirty: 0, untracked: 0, staged: false });
});
