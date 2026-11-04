// Detached scratch worktrees at a pinned commit, plus a child runner whose whole process
// group can be stopped. Shared by checkcommits (F-44) and the planned prefix-check (F-75).
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const active = new Set();

/**
 * Run `command args` in its own process group. Output goes to `logFile` (if given) and is
 * returned as `output`. Resolves on exit; never rejects. A spawn failure has `error` set.
 */
export function run(command, args, { cwd, env = process.env, logFile } = {}) {
  return new Promise((resolve) => {
    const log = logFile ? createWriteStream(logFile) : null;
    const chunks = [];
    const done = (result) => {
      active.delete(child);
      const output = Buffer.concat(chunks).toString('utf8');
      if (log) log.end(() => resolve({ ...result, output })); else resolve({ ...result, output });
    };
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (data) => { chunks.push(data); log?.write(data); });
    }
    child.on('error', (error) => done({ code: null, signal: null, error: error.message }));
    child.on('close', (code, signal) => done({ code, signal, error: null }));
  });
}

const KILL_GRACE_MS = 2000;
const signalGroup = (child, signal) => {
  for (const target of [-child.pid, child.pid]) {
    try { process.kill(target, signal); return; } catch { /* exited, or group not ours */ }
  }
};

/**
 * Signal every running child's process group, then SIGKILL groups still running after a
 * grace period: shells start background jobs with SIGINT ignored, and such a grandchild
 * would otherwise keep the output pipe (and this process) open.
 */
export function stopAll(signal = 'SIGTERM') {
  const targets = [...active];
  for (const child of targets) signalGroup(child, signal);
  setTimeout(() => {
    for (const child of targets) if (active.has(child)) signalGroup(child, 'SIGKILL');
  }, KILL_GRACE_MS).unref();
}

/**
 * Create a detached worktree of `commit` under a fresh temp directory, run `action`, then
 * remove it whatever happened. Returns `{ value, cleanup }`; cleanup is 'removed' or a
 * message naming the retained path. Rethrows the action's error after cleanup.
 */
export async function withScratchWorktree({ root, commit, prefix = 'rb2r-scratch-' }, action) {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  const directory = join(parent, 'tree');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  let value, failure, failed = false;
  try {
    git('worktree', 'add', '--detach', '--quiet', directory, commit);
    value = await action({ directory });
  } catch (error) { failure = error; failed = true; }
  let cleanup = 'removed';
  try { git('worktree', 'remove', '--force', directory); } catch { /* not registered or busy */ }
  try {
    await rm(parent, { recursive: true, force: true });
    git('worktree', 'prune');
  } catch (error) { cleanup = `retained ${parent}: ${error.message}`; }
  if (failed) { if (failure && typeof failure === 'object') failure.cleanup = cleanup; throw failure; }
  return { value, cleanup };
}
