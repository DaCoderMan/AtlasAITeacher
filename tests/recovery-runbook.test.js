import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runbook = JSON.parse(
  readFileSync(new URL('../runbooks/neon-recovery.v1.json', import.meta.url), 'utf8')
);

test('Neon recovery runbook is explicit, non-destructive, and reversible', () => {
  assert.equal(runbook.version, 'neon-recovery.v1');
  assert.equal(runbook.recovery_drill.strategy, 'branch_clone_validation');
  assert.equal(runbook.rollback_and_safety.destructive_actions_allowed, false);
  assert.equal(runbook.rollback_and_safety.cleanup_required, true);
  assert.equal(runbook.rollback_and_safety.cleanup_action, 'Delete the disposable proof branch after evidence capture.');
  assert.deepEqual(runbook.required_evidence_ids, ['tests', 'recovery-evidence', 'production-readback']);
  assert.ok(runbook.recovery_drill.steps.some(step => step.id === 'create-proof-branch'));
  assert.ok(runbook.recovery_drill.steps.some(step => step.id === 'cleanup-proof-branch'));
});
