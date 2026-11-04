import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { compareRoots } from './differential-probe.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scenario = fileURLToPath(new URL('./fixtures/differential/scenario.mjs', import.meta.url));
const baseline = fileURLToPath(new URL('./fixtures/differential/baseline', import.meta.url));
const candidate = fileURLToPath(new URL('./fixtures/differential/candidate', import.meta.url));
const cli = fileURLToPath(new URL('./differential-probe.mjs', import.meta.url));

function assertVerdict(report, expected) {
  assert.equal(report.verdict, expected, report.verdict === expected ? undefined :
    inspect(report, { depth: null, maxArrayLength: null, maxStringLength: null }));
}

function assertExit(run, expected) {
  assert.equal(run.status, expected, run.status === expected ? undefined :
    inspect({ status: run.status, signal: run.signal, error: run.error, stdout: run.stdout, stderr: run.stderr },
      { depth: null, maxStringLength: null }));
}

test('same root runs scenario, inputs and lazy singleton from scratch in each process', async () => {
  const input = { calls: 0 };
  const options = { baseline, candidate: baseline, scenario, input };
  const result = await compareRoots(options);
  assertVerdict(result, 'equal');
  assert.deepEqual(result.baseline.result, {
    scenarioCalls: 1, inputCalls: 1, cold: false, warm: true, observations: [1, 2],
  });
  assert.notEqual(result.baseline.pid, result.candidate.pid);
  assert.equal(input.calls, 0);
  const repeated = await compareRoots(options);
  assertVerdict(repeated, 'equal');
  assert.deepEqual(repeated.baseline.result, result.baseline.result);
  const equivalent = await compareRoots({
    ...options,
    candidate: fileURLToPath(new URL('./fixtures/differential/equivalent', import.meta.url)),
  });
  assertVerdict(equivalent, 'equal');
  assert.deepEqual(equivalent.candidate.result, result.baseline.result);
});

test('CLI reports changed observations, exact checkout evidence, and mismatch exit', () => {
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', candidate, '--scenario', scenario], { encoding: 'utf8', cwd: root });
  assertExit(run, 1);
  const report = JSON.parse(run.stdout);
  assertVerdict(report, 'different');
  assert.equal(report.difference.path, '$["observations"][0]');
  assert.equal(report.difference.baseline, 1);
  assert.equal(report.difference.candidate, 11);
  assert.equal(report.baseline.evidence.root, baseline);
  assert.match(report.baseline.evidence.revision, /^[0-9a-f]{40}$/);
  assert.match(report.scenario.sha256, /^[0-9a-f]{64}$/);
});

// A throwaway checkout shaped like the repo: a committed src/ input and manifest.
function scratchCheckout() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rb2r-probe-evidence-')));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/input.ts'), 'export const value = 1;\n');
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
  return dir;
}

test('files the scenarios never read may change during a run (F-113)', async () => {
  const dir = scratchCheckout();
  try {
    for (const file of ['pnpm-test.log', 'test-results.json']) {
      const report = await compareRoots({ baseline: dir, candidate: dir, scenario, input: { mode: 'write', file } });
      assertVerdict(report, 'equal');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an edit to a scenario input during a run still fails the comparison', async () => {
  const dir = scratchCheckout();
  try {
    for (const file of ['src/input.ts', 'src/new.ts', 'package.json']) {
      const report = await compareRoots({ baseline: dir, candidate: dir, scenario, input: { mode: 'write', file } });
      assertVerdict(report, 'failed');
      assert.match(report.baseline.error, /checkout changed during scenario execution/, file);
      assert.match(report.candidate.error, /checkout changed during scenario execution/, file);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('errors, nonzero exit, late exit, missing result and timeout never compare equal', async () => {
  for (const mode of ['throw', 'exit', 'late-exit', 'no-result', 'hang']) {
    const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode }, timeoutMs: mode === 'hang' ? 2000 : 60000 });
    assertVerdict(report, 'failed');
    assert.equal(report.baseline.ok, false, mode);
    assert.match(report.baseline.error, mode === 'throw' ? /scenario exploded/ : mode === 'hang' ? /timed out/ : mode === 'no-result' ? /without a result/ : /exit.*[79]/);
  }
});

test('special number identities survive IPC, input cloning and CLI JSON', async () => {
  for (const [mode, expected] of [['nan', NaN], ['infinity', Infinity], ['negative-zero', -0]]) {
    const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode } });
    assertVerdict(report, 'equal');
    assert.ok(Object.is(report.baseline.result.value, expected), mode);
  }
  const inputReport = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'echo', value: -0 } });
  assert.ok(Object.is(inputReport.baseline.result.value, -0));
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', baseline, '--scenario', scenario, '--input', '{"mode":"specials"}'], { encoding: 'utf8', cwd: root });
  assertExit(run, 0);
  assert.deepEqual(JSON.parse(run.stdout).baseline.result, [
    { $number: 'NaN' }, { $number: 'Infinity' }, { $number: '-Infinity' }, { $number: '-0' },
  ]);
});

test('NaN is not null and negative zero is not positive zero', async () => {
  for (const mode of ['nan-null', 'signed-zero']) {
    const report = await compareRoots({ baseline, candidate, scenario, input: { mode } });
    assertVerdict(report, 'different');
    assert.equal(report.difference.path, '$["value"]');
    assert.ok(Object.is(report.difference.baseline, mode === 'nan-null' ? NaN : -0));
    assert.ok(Object.is(report.difference.candidate, mode === 'nan-null' ? null : 0));
  }
});

test('unsupported or ambiguous payloads fail rather than losing properties', async () => {
  const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'undefined' } });
  assertVerdict(report, 'failed');
  assert.match(report.baseline.error, /\$\["value"\]/);
  await assert.rejects(compareRoots({ baseline, candidate, scenario, input: { $number: 'NaN' } }), /reserved/);
  const subclass = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'array-subclass' } });
  assertVerdict(subclass, 'failed');
  assert.match(subclass.baseline.error, /plain array/);
});

test('CLI scenario exceptions exit with failure and retain useful diagnostics', () => {
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', baseline, '--scenario', scenario, '--input', '{"mode":"throw"}'], { encoding: 'utf8', cwd: root });
  assertExit(run, 2);
  const report = JSON.parse(run.stdout);
  assertVerdict(report, 'failed');
  assert.match(report.candidate.error, /scenario exploded/);
});

test('real leaf, full world and generated-mission graphs are equal with identical lazy setup', async () => {
  for (const name of ['geo-equivalence', 'world-equivalence', 'mission-equivalence']) {
    const report = await compareRoots({
      baseline: root, candidate: root,
      scenario: fileURLToPath(new URL(`./scenarios/${name}.mjs`, import.meta.url)),
      input: { seed: 42 },
    });
    assertVerdict(report, 'equal');
    if (name === 'world-equivalence') {
      assert.ok(report.baseline.result.setup.cold.every((ready) => !ready));
      assert.ok(report.baseline.result.setup.warm.every(Boolean));
    }
    if (name === 'mission-equivalence') {
      const { career, quick } = report.baseline.result;
      assert.deepEqual([...career, ...quick].filter((m) => m.error), []);
      assert.ok(new Set(career.map((m) => m.type)).size >= 8, 'every career mission type is generated');
      assert.deepEqual([...new Set(quick.map((m) => m.type))].sort(),
        ['balloon-attack', 'bombing', 'dogfight', 'escort', 'ground-attack', 'intercept']);
    }
  }
});

test('AI equivalence default suite reproduces exactly in fresh processes', { timeout: 120000 }, async () => {
  const aiScenario = fileURLToPath(new URL('./scenarios/ai-equivalence.mjs', import.meta.url));
  const report = await compareRoots({ baseline: root, candidate: root, scenario: aiScenario, input: { suite: 'default' }, timeoutMs: 120000 });
  // Equal here catches nondeterminism (unseeded Math.random, run-dependent Map/Set order).
  assertVerdict(report, 'equal');
  const { cases } = report.baseline.result;
  assert.ok(cases.length > 0);
  for (const c of cases) {
    assert.ok(c.samples.length > 0, c.id);
    assert.ok(c.samples.every((s) => s.aircraft.length > 0), c.id);
  }
  // Not trivially quiet: the furballs shoot, hit and kill, so combat paths are in the trace.
  const furballs = cases.filter((c) => c.kind === 'furball');
  assert.ok(furballs.some((c) => (c.tally.events['bullet-hit'] ?? 0) > 0));
  assert.ok(furballs.some((c) => (c.tally.events['aircraft-destroyed'] ?? 0) > 0));
  assert.ok(cases.some((c) => c.kind === 'quick'), 'SimCore game path covered');
  const empty = await compareRoots({ baseline: root, candidate: root, scenario: aiScenario, input: {} });
  assertVerdict(empty, 'failed');
});
