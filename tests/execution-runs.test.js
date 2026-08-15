import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExecutionProgress, normalizeExecutionRunbook } from '../lib/execution-runs.js';

test('normalizeExecutionRunbook validates unique dependencies and preserves ordered steps', () => {
  const runbook = normalizeExecutionRunbook({
    run_key: 'codex-job',
    steps: [
      { step_key: 'a', title: 'First step' },
      { step_key: 'b', title: 'Second step', depends_on: ['a'], canonical_task_key: 'CX-010' }
    ]
  });
  assert.equal(runbook.run_key, 'codex-job');
  assert.equal(runbook.steps[0].step_index, 1);
  assert.equal(runbook.steps[1].depends_on_step_keys[0], 'a');
  assert.equal(runbook.steps[1].canonical_task_key, 'CX-010');
});

test('normalizeExecutionRunbook rejects unknown dependency targets', () => {
  assert.throws(() => normalizeExecutionRunbook({
    run_key: 'broken-job',
    steps: [{ step_key: 'a', title: 'A', depends_on: ['missing'] }]
  }), /depends on unknown step/);
});

test('buildExecutionProgress renders task-aware and overall progress strings', () => {
  const progress = buildExecutionProgress(
    { id: 'r1', run_key: 'job', run_revision: 1, status: 'in_progress', total_steps: 3, completed_steps: 1, blocked_steps: 0, current_step_index: 2 },
    [
      { id: 's1', step_index: 1, step_key: 'a', title: 'A', status: 'completed', canonical_task_key: 'CX-010' },
      { id: 's2', step_index: 2, step_key: 'b', title: 'B', status: 'in_progress', canonical_task_key: 'CX-010' },
      { id: 's3', step_index: 3, step_key: 'c', title: 'C', status: 'pending', canonical_task_key: 'CX-011' }
    ]
  );
  assert.equal(progress.current_step.step_key, 'b');
  assert.equal(progress.task_progress.canonical_task_key, 'CX-010');
  assert.match(progress.progress_message, /CX-010, step 2\/2; overall 1\/3 steps/);
});

test('codex x runbook file is machine-readable and ordered', () => {
  const runbook = JSON.parse(readFileSync(new URL('../runbooks/codex-x-execution-order.v1.json', import.meta.url), 'utf8'));
  assert.equal(runbook.run_key, 'codex-x-execution-order-v2');
  assert.ok(runbook.steps.length >= 10);
  assert.equal(runbook.steps[0].canonical_task_key, 'CX-001');
});
