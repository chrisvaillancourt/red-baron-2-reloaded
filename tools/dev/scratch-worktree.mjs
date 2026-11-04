// Detached scratch worktrees at a pinned commit, plus a child runner whose whole process
// group is stopped when it finishes or is interrupted. Shared by checkcommits (F-44) and the
// planned prefix-check (F-75).
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const KILL_GRACE_MS = 2000;
const LINGER_MS = 500;
const active = new Set();
const signaled = new Set();

const signalGroup = (pid, signal) => {
  try { process.kill(-pid, signal); } catch { /* group already gone */ }
};

/**
 * Environment for commands that must behave as in a fresh checkout of `root`'s repo: drop
 * PATH entries inside `root` (such as the caller's node_modules/.bin, added by `pnpm exec`)
 * and the npm/pnpm variables a parent script run exports.
 */
export function isolatedEnv(root, env = process.env) {
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const top = real(root);
  const inside = (p) => { const abs = real(p); return abs === top || abs.startsWith(`${top}/`); };
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(npm_|pnpm_|PNPM_)/i.test(key) || key === 'INIT_CWD') continue;
    clean[key] = value;
  }
  clean.PATH = (env.PATH ?? '').split(':').filter((p) => p && !inside(p)).join(':');
  return clean;
}

/**
 * Run `command args` in its own process group. Output goes to `logFile` (if given) and is
 * returned as `output`. When the command exits, anything left in its group is killed, so a
 * stray background child can neither outlive it nor hold the output pipe open. Never rejects;
 * a spawn failure has `error` set.
 */
export function run(command, args, { cwd, env = process.env, logFile } = {}) {
  return new Promise((done) => {
    const log = logFile ? createWriteStream(logFile) : null;
    const chunks = [];
    let result = null;
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = () => {
      active.delete(child);
      const output = Buffer.concat(chunks).toString('utf8');
      if (log) log.end(() => done({ ...result, output })); else done({ ...result, output });
    };
    active.add(child);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (data) => { chunks.push(data); log?.write(data); });
    }
    child.on('error', (error) => { result ??= { code: null, signal: null, error: error.message }; finish(); });
    child.on('exit', (code, signal) => {
      result ??= { code, signal, error: null };
      // The leader is gone; give its group a moment to finish writing, then clear it out.
      setTimeout(() => {
        signalGroup(child.pid, 'SIGKILL');
        for (const stream of [child.stdout, child.stderr]) stream.destroy();
      }, LINGER_MS).unref();
    });
    child.on('close', () => {
      result ??= { code: null, signal: null, error: null };
      signalGroup(child.pid, 'SIGKILL'); // background children that didn't hold the pipe
      finish();
    });
  });
}

/**
 * Signal every running child's process group, then SIGKILL each of those groups after a grace
 * period, whether or not its leader has exited: shells start background jobs with SIGINT
 * ignored, so a grandchild can outlive the signal.
 */
export function stopAll(signal = 'SIGTERM') {
  for (const child of active) { signaled.add(child.pid); signalGroup(child.pid, signal); }
  setTimeout(() => {
    for (const pid of signaled) signalGroup(pid, 'SIGKILL');
    signaled.clear();
  }, KILL_GRACE_MS).unref();
}

/**
 * Create a detached worktree of `commit` under a fresh temp directory, run `action`, then
 * remove it whatever happened. Touches only this worktree's own registration. Returns
 * `{ value, cleanup }`; cleanup is 'removed' or a message naming what was retained.
 * Rethrows the action's error (with `.cleanup` set) after cleanup.
 */
export async function withScratchWorktree({ root, commit, prefix = 'rb2r-scratch-' }, action) {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  const directory = join(parent, 'tree');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', env: isolatedEnv(root) });
  let value, failure, failed = false;
  try {
    git('worktree', 'add', '--detach', '--quiet', directory, commit);
    value = await action({ directory });
  } catch (error) { failure = error; failed = true; }
  const cleanup = await removeScratch(root, parent, directory, git);
  if (failed) { if (failure && typeof failure === 'object') failure.cleanup = cleanup; throw failure; }
  return { value, cleanup };
}

async function removeScratch(root, parent, directory, git) {
  // The tree's own administrative directory, read from its .git file before anything is deleted.
  let admin = null;
  try {
    const pointer = readFileSync(join(directory, '.git'), 'utf8').match(/^gitdir: (.+)$/m)?.[1];
    if (pointer) admin = isAbsolute(pointer) ? pointer : resolve(directory, pointer);
    const common = resolve(root, git('rev-parse', '--git-common-dir').toString().trim());
    if (admin && !admin.startsWith(`${join(common, 'worktrees')}/`)) admin = null;
  } catch { /* add failed before creating the tree */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    try { git('worktree', 'remove', '--force', directory); break; } catch { /* busy or unregistered */ }
  }
  try {
    await rm(parent, { recursive: true, force: true });
    if (admin) await rm(admin, { recursive: true, force: true });
    return 'removed';
  } catch (error) {
    return `retained ${parent}${admin ? ` and ${admin}` : ''}: ${error.message}`;
  }
}
