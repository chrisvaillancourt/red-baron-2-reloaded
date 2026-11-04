#!/usr/bin/env node
// Read-only inventory of every registered worktree, for the "Preserve worktrees" check before
// asking to remove one. It never removes, prunes, locks or writes anything.
//
//   pnpm exec node tools/dev/worktrees.mjs [--json] [--base <ref>]
//
// Per worktree: branch (or detached SHA), merged into the base (default origin/main, via
// `git merge-base --is-ancestor`), dirty tracked files, untracked files, staged changes,
// MERGE_HEAD, commits ahead of the base, last commit date, locked, prunable, and whether it
// sits under the OS temp dir. The summary names the candidates that look safe to remove:
// merged, no tracked/untracked/staged changes, no MERGE_HEAD, unlocked, not the main checkout.
// Exit 0, or 2 on bad arguments or an unresolvable base.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
// No optional locks: `git status` must not refresh another session's index.
const exec = (cmd, args, opts = {}) => run(cmd, args, { ...opts, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
  delete process.env[key];
}

const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })).stdout;
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

function usage(code, message) {
  if (message) process.stderr.write(`worktrees: ${message}\n`);
  process.stderr.write('Usage: pnpm exec node tools/dev/worktrees.mjs [--json] [--base <ref>]\n');
  process.exit(code);
}

/** Parse `git worktree list --porcelain` into records (the first is the main checkout). */
export function parsePorcelain(text) {
  return text.split('\n\n').filter((block) => block.trim()).map((block) => {
    const entry = { path: null, head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') entry.path = value;
      else if (key === 'HEAD') entry.head = value;
      else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'bare') entry.bare = true;
      else if (key === 'detached') entry.detached = true;
      else if (key === 'locked') entry.locked = true;
      else if (key === 'prunable') entry.prunable = true;
    }
    return entry;
  });
}

/** Counts from `git status --porcelain=v1 -z`: changed tracked files, untracked, any staged. */
export function parseStatus(text) {
  let dirty = 0, untracked = 0, staged = false;
  const records = text.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 3) continue;
    const x = record[0], y = record[1];
    if (x === '?' && y === '?') { untracked++; continue; }
    if (x === '!') continue;
    dirty++;
    if (x !== ' ') staged = true;
    if (x === 'R' || x === 'C') i++; // the next record is the rename/copy source
  }
  return { dirty, untracked, staged };
}

async function inspect(entry, index, base, temps) {
  const row = {
    path: entry.path, main: index === 0, branch: entry.branch, head: entry.head,
    detached: entry.detached || (!entry.branch && !entry.bare), bare: entry.bare,
    locked: entry.locked, prunable: entry.prunable || !existsSync(entry.path),
    underTmp: temps.some((t) => real(entry.path) === t || real(entry.path).startsWith(`${t}/`)),
    merged: null, ahead: null, lastCommit: null, dirty: null, untracked: null, staged: null, mergeHead: null, error: null,
  };
  if (row.prunable || row.bare || !entry.head) return row;
  try {
    const [merged, ahead, last, status, mergeHeadPath] = await Promise.all([
      exec('git', ['-C', entry.path, 'merge-base', '--is-ancestor', entry.head, base]).then(() => true, (e) => {
        if (e.code === 1) return false;
        throw e;
      }),
      git(entry.path, 'rev-list', '--count', `${base}..${entry.head}`),
      git(entry.path, 'log', '-1', '--format=%cI', entry.head),
      git(entry.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
      git(entry.path, 'rev-parse', '--git-path', 'MERGE_HEAD'),
    ]);
    const mergeHead = mergeHeadPath.trim();
    Object.assign(row, parseStatus(status), {
      merged, ahead: Number(ahead.trim()), lastCommit: last.trim(),
      mergeHead: existsSync(isAbsolute(mergeHead) ? mergeHead : resolve(entry.path, mergeHead)),
    });
  } catch (error) {
    row.error = (error.stderr || error.message || String(error)).trim().split('\n')[0];
  }
  return row;
}

export const isCandidate = (r) => !r.main && !r.bare && !r.prunable && !r.locked && !r.error &&
  r.merged === true && r.dirty === 0 && r.untracked === 0 && r.staged === false && r.mergeHead === false;

const yn = (v) => (v === null ? '-' : v ? 'y' : 'n');

function table(rows) {
  const header = ['path', 'branch', 'merged', 'dirty', 'untracked', 'staged', 'MERGE_HEAD', 'ahead', 'last commit', 'locked', 'prunable', 'tmp'];
  const lines = rows.map((r) => [
    `${r.path}${r.main ? ' (main)' : ''}`,
    r.bare ? '(bare)' : r.branch ?? `(detached ${r.head?.slice(0, 10) ?? '?'})`,
    yn(r.merged), r.dirty ?? '-', r.untracked ?? '-', yn(r.staged), yn(r.mergeHead), r.ahead ?? '-',
    r.lastCommit ?? (r.error ? `error: ${r.error}` : '-'), yn(r.locked), yn(r.prunable), yn(r.underTmp),
  ].map(String));
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  return [header, ...lines].map((l) => l.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

async function main(args) {
  let json = false, base = 'origin/main';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--base') { base = args[++i]; if (!base || base.startsWith('-')) usage(2, '--base needs a ref'); }
    else if (args[i] === '--help' || args[i] === '-h') usage(0);
    else usage(2, `unknown argument ${JSON.stringify(args[i])}`);
  }
  let root;
  try { root = (await git(process.cwd(), 'rev-parse', '--show-toplevel')).trim(); } catch { usage(2, 'not inside a Git repository'); }
  let baseSha;
  try { baseSha = (await git(root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`)).trim(); } catch { usage(2, `cannot resolve base ${JSON.stringify(base)}`); }
  const temps = [...new Set([tmpdir(), '/tmp'].map(real))];
  const entries = parsePorcelain(await git(root, 'worktree', 'list', '--porcelain'));
  const rows = await Promise.all(entries.map((entry, index) => inspect(entry, index, baseSha, temps)));
  const candidates = rows.filter(isCandidate).map((r) => r.path);
  const prunable = rows.filter((r) => r.prunable).map((r) => r.path);

  if (json) {
    process.stdout.write(`${JSON.stringify({ base, baseSha, worktrees: rows, candidates, prunable }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${table(rows)}\n\n`);
  process.stdout.write(`Base ${base} (${baseSha.slice(0, 10)}). Nothing was removed.\n`);
  process.stdout.write(`Look safe to remove (merged, clean, no MERGE_HEAD, unlocked, not main): ${candidates.length}${candidates.length ? `\n  ${candidates.join('\n  ')}` : ''}\n`);
  if (prunable.length) process.stdout.write(`Prunable (directory gone; \`git worktree prune\` clears them): ${prunable.length}\n  ${prunable.join('\n  ')}\n`);
  process.stdout.write('Check ignored scratch files and running processes, then get approval before removing any.\n');
}

if (import.meta.main) await main(process.argv.slice(2));
