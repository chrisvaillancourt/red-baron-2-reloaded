#!/usr/bin/env node
/**
 * CPU-only, exact observations from the same scenario in two fresh processes.
 *   node tools/dev/differential-probe.mjs --baseline <root> --candidate <root> \
 *     --scenario tools/dev/scenarios/world-equivalence.mjs --input '{"seed":42}'
 * Existing roots only: prepare any detached baseline worktree yourself. No installs,
 * project Vite config, browser, source swapping or automatic worktree lifecycle.
 * Exit 0 = equal, 1 = different, 2 = failed. JSON report includes both observations.
 */
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { firstDifference, numberReplacer, validateValue } from './differential-values.mjs';

const WORKER = fileURLToPath(new URL('./differential-worker.mjs', import.meta.url));
const HELP = `Usage: node tools/dev/differential-probe.mjs --baseline <root> --candidate <root>
  --scenario <scenario.mjs> [--input <JSON>] [--timeout-ms <positive integer>]
Same default-exported scenario({ load, input }) in each fresh Node/Vite SSR worker.
load('src/world/landuse.ts') resolves from that worker's root. input is cloned JSON.
Return plain objects, arrays, strings, booleans, null and numbers. NaN, Infinity,
-Infinity and -0 retain identity; CLI JSON tags them as {$number:"NaN"}, etc.
JSON stdout: roots/revisions/dirty-tree fingerprints, scenario hash, observations,
first differing path, errors and worker logs. Exit: 0 equal, 1 different, 2 failed.
Roots must exist within Git checkouts; dependencies must already be available.
No project Vite config/.env, browser or worktree/config mutation. Default timeout 60000 ms.
`;

/** Public module API; no closures or side-specific setup functions cross the boundary. */
export async function compareRoots({ baseline, candidate, scenario, input = null, timeoutMs = 60000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('timeoutMs must be an integer from 1 to 2147483647');
  validateValue(input);
  const inputSnapshot = structuredClone(input);
  const scenarioPath = realpathSync(resolve(scenario));
  const scenarioHash = createHash('sha256').update(readFileSync(scenarioPath)).digest('hex');
  const roots = [baseline, candidate].map((root) => realpathSync(resolve(root)));
  const env = { ...process.env, NODE_ENV: 'development' };
  const runs = [];
  // Sequential workers avoid competing CPU jobs; each still has a new module graph,
  // scenario module, process globals, dependencies and mutable input object.
  const evidence = roots.map(checkoutEvidence);
  for (let i = 0; i < roots.length; i++) {
    const run = await runWorker({ root: roots[i], scenario: scenarioPath, input: structuredClone(inputSnapshot) }, timeoutMs, env);
    runs.push({ ...run, evidence: evidence[i] });
  }
  const currentHash = createHash('sha256').update(readFileSync(scenarioPath)).digest('hex');
  for (const run of runs) {
    const after = checkoutEvidence(run.evidence.root);
    if (JSON.stringify(run.evidence) !== JSON.stringify(after)) {
      run.ok = false;
      run.error = 'comparison checkout changed during scenario execution';
      run.afterEvidence = after;
    }
    if (currentHash !== scenarioHash) {
      run.ok = false;
      run.error = 'scenario source changed during comparison';
    }
  }
  const [a, b] = runs;
  const difference = a.ok && b.ok ? firstDifference(a.result, b.result) : null;
  return {
    verdict: !a.ok || !b.ok ? 'failed' : difference ? 'different' : 'equal',
    scenario: { path: scenarioPath, sha256: scenarioHash },
    input: inputSnapshot,
    numberEncoding: 'Special numbers use reserved {$number:"NaN"|"Infinity"|"-Infinity"|"-0"} tags in CLI JSON; module results retain native numbers',
    runtime: { node: process.version, loader: 'Vite SSR (tool checkout dependencies)', nodeEnv: env.NODE_ENV },
    baseline: a,
    candidate: b,
    difference,
  };
}

function checkoutEvidence(root) {
  const git = (args, cwd = root) => execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024 });
  const gitRoot = git(['rev-parse', '--show-toplevel']).toString().trim();
  const revision = git(['rev-parse', 'HEAD']).toString().trim();
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], gitRoot).toString();
  const trackedDiffSha256 = createHash('sha256').update(git(['diff', '--binary', 'HEAD', '--'], gitRoot)).digest('hex');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], gitRoot).toString().split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const path of untracked.sort()) {
    const bytes = readFileSync(join(gitRoot, path));
    hash.update(JSON.stringify([path, bytes.length]));
    hash.update(bytes);
  }
  return { root, gitRoot, revision, dirty: status.length > 0, status, trackedDiffSha256, untrackedSha256: hash.digest('hex') };
}

function runWorker(job, timeoutMs, env) {
  return new Promise((resolveRun) => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rb2r-probe-vite-'));
    const child = fork(WORKER, [], {
      cwd: job.root,
      env,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let packet;
    let error;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-16384); });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16384); });
    child.on('message', (message) => {
      if (packet) error = 'worker sent multiple results';
      packet = message;
    });
    child.on('error', (cause) => { error = cause.stack ?? String(cause); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      rmSync(cacheDir, { recursive: true, force: true });
      if (timedOut) error = `worker timed out after ${timeoutMs} ms`;
      else if (exitCode !== 0 || signal) error = `worker exited ${exitCode} (signal ${signal ?? 'none'})`;
      else if (!packet) error ??= 'worker exited without a result';
      if (!error && packet?.ok) {
        try { validateValue(packet.result); } catch (cause) { error = cause.message; }
      }
      if (!error && typeof packet?.ok !== 'boolean') error = 'invalid worker result';
      resolveRun({ ...(packet ?? {}), ...(error ? { ok: false, error } : {}), exitCode, signal, stdout, stderr });
    });
    child.send({ ...job, cacheDir }, (cause) => {
      if (cause) {
        error = `could not send scenario: ${cause.message}`;
        child.kill('SIGKILL');
      }
    });
  });
}

async function main() {
  try {
    const { values } = parseArgs({ options: {
      baseline: { type: 'string' }, candidate: { type: 'string' }, scenario: { type: 'string' },
      input: { type: 'string', default: 'null' }, 'timeout-ms': { type: 'string', default: '60000' },
      help: { type: 'boolean', short: 'h' },
    } });
    if (values.help) { process.stdout.write(HELP); return; }
    if (!values.baseline || !values.candidate || !values.scenario) throw new Error('--baseline, --candidate and --scenario are required (see --help)');
    const report = await compareRoots({ ...values, input: JSON.parse(values.input), timeoutMs: Number(values['timeout-ms']) });
    process.stdout.write(`${JSON.stringify(report, numberReplacer, 2)}\n`);
    process.exitCode = report.verdict === 'equal' ? 0 : report.verdict === 'different' ? 1 : 2;
  } catch (error) {
    process.stderr.write(`differential-probe: ${error.stack ?? error}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
