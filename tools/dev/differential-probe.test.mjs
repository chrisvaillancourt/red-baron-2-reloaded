import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compareRoots } from './differential-probe.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scenario = fileURLToPath(new URL('./fixtures/differential/scenario.mjs', import.meta.url));
const baseline = fileURLToPath(new URL('./fixtures/differential/baseline', import.meta.url));
const candidate = fileURLToPath(new URL('./fixtures/differential/candidate', import.meta.url));
const cli = fileURLToPath(new URL('./differential-probe.mjs', import.meta.url));

test('same root runs scenario, inputs and lazy singleton from scratch in each process', async () => {
  const input = { calls: 0 };
  const options = { baseline, candidate: baseline, scenario, input };
  const result = await compareRoots(options);
  assert.equal(result.verdict, 'equal');
  assert.deepEqual(result.baseline.result, {
    scenarioCalls: 1, inputCalls: 1, cold: false, warm: true, observations: [1, 2],
  });
  assert.notEqual(result.baseline.pid, result.candidate.pid);
  assert.equal(input.calls, 0);
  const repeated = await compareRoots(options);
  assert.deepEqual(repeated.baseline.result, result.baseline.result);
  assert.equal(repeated.verdict, 'equal');
  const equivalent = await compareRoots({
    ...options,
    candidate: fileURLToPath(new URL('./fixtures/differential/equivalent', import.meta.url)),
  });
  assert.equal(equivalent.verdict, 'equal');
  assert.deepEqual(equivalent.candidate.result, result.baseline.result);
});

test('CLI reports changed observations, exact checkout evidence, and mismatch exit', () => {
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', candidate, '--scenario', scenario], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.verdict, 'different');
  assert.equal(report.difference.path, '$["observations"][0]');
  assert.equal(report.difference.baseline, 1);
  assert.equal(report.difference.candidate, 11);
  assert.equal(report.baseline.evidence.root, baseline);
  assert.match(report.baseline.evidence.revision, /^[0-9a-f]{40}$/);
  assert.match(report.scenario.sha256, /^[0-9a-f]{64}$/);
});

test('errors, nonzero exit, late exit, missing result and timeout never compare equal', async () => {
  for (const mode of ['throw', 'exit', 'late-exit', 'no-result', 'hang']) {
    const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode }, timeoutMs: mode === 'hang' ? 2000 : 60000 });
    assert.equal(report.verdict, 'failed', mode);
    assert.equal(report.baseline.ok, false, mode);
    assert.match(report.baseline.error, mode === 'throw' ? /scenario exploded/ : mode === 'hang' ? /timed out/ : mode === 'no-result' ? /without a result/ : /exit.*[79]/);
  }
});

test('special number identities survive IPC, input cloning and CLI JSON', async () => {
  for (const [mode, expected] of [['nan', NaN], ['infinity', Infinity], ['negative-zero', -0]]) {
    const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode } });
    assert.equal(report.verdict, 'equal', mode);
    assert.ok(Object.is(report.baseline.result.value, expected), mode);
  }
  const inputReport = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'echo', value: -0 } });
  assert.ok(Object.is(inputReport.baseline.result.value, -0));
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', baseline, '--scenario', scenario, '--input', '{"mode":"specials"}'], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).baseline.result, [
    { $number: 'NaN' }, { $number: 'Infinity' }, { $number: '-Infinity' }, { $number: '-0' },
  ]);
});

test('NaN is not null and negative zero is not positive zero', async () => {
  for (const mode of ['nan-null', 'signed-zero']) {
    const report = await compareRoots({ baseline, candidate, scenario, input: { mode } });
    assert.equal(report.verdict, 'different', mode);
    assert.equal(report.difference.path, '$["value"]');
    assert.ok(Object.is(report.difference.baseline, mode === 'nan-null' ? NaN : -0));
    assert.ok(Object.is(report.difference.candidate, mode === 'nan-null' ? null : 0));
  }
});

test('unsupported or ambiguous payloads fail rather than losing properties', async () => {
  const report = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'undefined' } });
  assert.equal(report.verdict, 'failed');
  assert.match(report.baseline.error, /\$\["value"\]/);
  await assert.rejects(compareRoots({ baseline, candidate, scenario, input: { $number: 'NaN' } }), /reserved/);
  const subclass = await compareRoots({ baseline, candidate: baseline, scenario, input: { mode: 'array-subclass' } });
  assert.equal(subclass.verdict, 'failed');
  assert.match(subclass.baseline.error, /plain array/);
});

test('CLI scenario exceptions exit with failure and retain useful diagnostics', () => {
  const run = spawnSync(process.execPath, [cli, '--baseline', baseline, '--candidate', baseline, '--scenario', scenario, '--input', '{"mode":"throw"}'], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 2);
  const report = JSON.parse(run.stdout);
  assert.equal(report.verdict, 'failed');
  assert.match(report.candidate.error, /scenario exploded/);
});

test('real leaf and full world graphs are equal with identical lazy setup', async () => {
  for (const name of ['geo-equivalence', 'world-equivalence']) {
    const report = await compareRoots({
      baseline: root, candidate: root,
      scenario: fileURLToPath(new URL(`./scenarios/${name}.mjs`, import.meta.url)),
      input: { seed: 42 },
    });
    assert.equal(report.verdict, 'equal', JSON.stringify(report.baseline));
    if (name === 'world-equivalence') {
      assert.ok(report.baseline.result.setup.cold.every((ready) => !ready));
      assert.ok(report.baseline.result.setup.warm.every(Boolean));
    }
  }
});
