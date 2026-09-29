#!/usr/bin/env node
/**
 * Block until files contain a pattern (FRICTION F-21). For agents that must wait on background
 * soaks inside one turn, where shell `until … sleep` loops are refused by the worktree sandbox.
 *
 *   node tools/dev/waitfor.mjs out1.txt '^RATES' out2.txt '^RATES' [--timeout 3600] [--every 5]
 *
 * Arguments come in file/regex pairs. Exits 0 once every file matches its regex (printing the
 * matching lines), 1 on timeout (printing which files are still waiting). A missing file counts
 * as not yet matching.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { timeout: { type: 'string', default: '3600' }, every: { type: 'string', default: '5' }, help: { type: 'boolean', short: 'h' } },
});
if (o.help) {
  process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0] + '*/\n');
  process.exit(0);
}
const num = (name, v) => {
  if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) {
    process.stderr.write(`waitfor: --${name} must be a positive number of seconds\n`);
    process.exit(2);
  }
  return Number(v);
};
const timeoutS = num('timeout', o.timeout);
const everyS = num('every', o.every);
if (positionals.length === 0 || positionals.length % 2) {
  process.stderr.write('waitfor: give <file> <regex> pairs\n');
  process.exit(2);
}
const pairs = [];
for (let i = 0; i < positionals.length; i += 2) pairs.push({ file: positionals[i], re: new RegExp(positionals[i + 1], 'm') });

const start = Date.now();
const check = () => pairs.map((p) => ({ ...p, hit: existsSync(p.file) ? readFileSync(p.file, 'utf8').match(p.re)?.[0] : undefined }));
for (;;) {
  const state = check();
  if (state.every((s) => s.hit !== undefined)) {
    for (const s of state) process.stdout.write(`${s.file}: ${s.hit}\n`);
    process.exit(0);
  }
  if ((Date.now() - start) / 1000 >= timeoutS) {
    for (const s of state.filter((x) => x.hit === undefined)) process.stdout.write(`waiting: ${s.file} for /${s.re.source}/\n`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, everyS * 1000));
}
