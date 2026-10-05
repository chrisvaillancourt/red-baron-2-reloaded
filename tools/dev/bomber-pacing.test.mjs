import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { compareRoots } from './differential-probe.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scenario = fileURLToPath(new URL('./fixtures/bomber-pacing-outcomes.mjs', import.meta.url));

test('real pacing sampler separates terminal survival from bombing objective success', async () => {
  const report = await compareRoots({ baseline: root, candidate: root, scenario });
  assert.equal(report.verdict, 'equal', inspect(report, { depth: null }));
  for (const { injectedOutcome, observation } of report.baseline.result) {
    assert.equal(observation.termination, 'mission-ended');
    assert.equal(observation.censored, false);
    assert.equal(observation.missionEnded, true);
    assert.equal(observation.final[0].outcome, injectedOutcome);
    assert.equal(observation.metrics[0].lost, injectedOutcome === 'shot-down');
    assert.ok(observation.metrics[0].steady.speedMps.count > 0, 'real live physics sampled before injection');
    assert.ok(observation.elapsedS < observation.capS, 'production terminal lifecycle ended before cap');
    assert.equal(observation.missionResult.playerOutcome, injectedOutcome);
    if (injectedOutcome !== 'shot-down') assert.equal(observation.missionResult.playerFate, 'returned');
    assert.equal(observation.missionResult.missionSuccess, false, 'safe return does not complete bombing');
    const bombing = observation.objectiveObservation.definitions.find((o) => o.kind === 'destroy-ground' && o.primary);
    assert.ok(bombing);
    assert.equal(observation.missionResult.objectives.find((o) => o.id === bombing.id).completed, false);
    assert.equal(observation.objectiveObservation.censored, false);
    assert.ok(observation.objectiveObservation.groundTargets.every((g) => !g.destroyed));
  }
});
