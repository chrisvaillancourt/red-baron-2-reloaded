#!/usr/bin/env node
/**
 * Relative Markdown link and anchor checker (GitHub-style heading slugs).
 *
 *   pnpm exec node tools/dev/mdlinks.mjs [repo-root]
 *
 * Checks every tracked *.md file (git ls-files): relative links must reach an existing
 * file, and a #fragment on a Markdown target must match a heading or an <a id>/<a name>.
 * External links (http:, mailto: …) and anything inside code are skipped. Prints each
 * broken link as file:line, then a total. Exit 0 when none are broken, 1 otherwise.
 * `mdlinks.test.mjs` runs it on the repo, so `pnpm test` fails on a broken doc link.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FENCE = /^\s*(```+|~~~+)/;

/** Lines with fenced blocks blanked and inline code masked, keeping line numbers. */
function proseLines(text) {
  const out = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const m = line.match(FENCE);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (m) { fence = m[1]; out.push(''); continue; }
    out.push(line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length)));
  }
  return out;
}

/** GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens. */
export function slug(text) {
  return text.trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/ /g, '-');
}

/** Anchors a Markdown file defines: heading slugs (with -1, -2 for repeats) and <a id>. */
export function anchorsOf(text) {
  const set = new Set();
  const counts = new Map();
  let fence = null;
  for (const line of text.split('\n')) {
    const m = line.match(FENCE);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; continue; }
    if (m) { fence = m[1]; continue; }
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const base = slug(h[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, ''));
      const n = counts.get(base) ?? 0;
      set.add(n === 0 ? base : `${base}-${n}`);
      counts.set(base, n + 1);
    }
    for (const a of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) set.add(a[1]);
  }
  return set;
}

/** Check the tracked Markdown under `root`. Returns { files, checked, broken: string[] }. */
export function checkLinks(root) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const anchorCache = new Map();
  const anchors = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };
  let checked = 0;
  const broken = [];
  for (const rel of files) {
    const abs = join(root, rel);
    proseLines(readFileSync(abs, 'utf8')).forEach((line, i) => {
      const targets = [...line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]);
      const ref = line.match(/^\s*\[[^\]]+\]:\s*(\S+)/);
      if (ref) targets.push(ref[1]);
      for (const t of targets) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(t)) continue;
        checked++;
        const [p, frag] = t.split('#');
        const target = p ? resolve(dirname(abs), decodeURIComponent(p)) : abs;
        if (!existsSync(target)) { broken.push(`${rel}:${i + 1}: missing file ${t}`); continue; }
        if (!frag || !target.endsWith('.md') || statSync(target).isDirectory()) continue;
        if (!anchors(target).has(decodeURIComponent(frag).toLowerCase())) broken.push(`${rel}:${i + 1}: missing anchor ${t}`);
      }
    });
  }
  return { files: files.length, checked, broken };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, checked, broken } = checkLinks(resolve(process.argv[2] ?? '.'));
  for (const b of broken) console.log(b);
  console.log(`files=${files} links_checked=${checked} broken=${broken.length}`);
  process.exit(broken.length ? 1 : 0);
}
