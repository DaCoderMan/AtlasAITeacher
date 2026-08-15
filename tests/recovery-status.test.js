import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecoveryStatus } from '../lib/recovery-status.js';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test('recovery status defaults to unverified without proof evidence', () => {
  delete process.env.ATLAS_RECOVERY_PROOF_AT;
  const status = getRecoveryStatus();
  assert.equal(status.status, 'unverified');
  assert.equal(status.strategy, 'branch_clone_validation');
  assert.equal(status.cleanup_verified, false);
});

test('recovery status exposes latest proof metadata and cleanup receipts', () => {
  process.env.ATLAS_RECOVERY_PROOF_STATUS = 'verified';
  process.env.ATLAS_RECOVERY_PROOF_AT = '2026-08-15T12:20:00Z';
  process.env.ATLAS_RECOVERY_PROJECT_ID = 'proud-forest-33537802';
  process.env.ATLAS_RECOVERY_MAIN_BRANCH_ID = 'br-main';
  process.env.ATLAS_RECOVERY_PROOF_BRANCH_ID = 'br-proof';
  process.env.ATLAS_RECOVERY_PRESERVED_BRANCH_ID = 'br-preserved';
  process.env.ATLAS_RECOVERY_PROOF_COMPUTE_ID = 'ep-proof';
  process.env.ATLAS_RECOVERY_BASELINE_TABLES = 'public.projects, public.tasks, public.atlas_events';
  process.env.ATLAS_RECOVERY_BASELINE_COUNTS = 'projects=35,tasks=130,atlas_events=91';
  process.env.ATLAS_RECOVERY_RESET_VERIFICATION = 'probe_table_absent_after_reset';
  process.env.ATLAS_RECOVERY_PRESERVED_STATE = 'probe_table_present_in_preserved_branch_diff';
  process.env.ATLAS_RECOVERY_CLEANUP_BRANCH_IDS = 'br-proof, br-preserved';
  process.env.ATLAS_RECOVERY_PROOF_READBACK = 'reset branch matched baseline and preserved branch kept probe diff';

  const status = getRecoveryStatus();
  assert.equal(status.status, 'verified');
  assert.equal(status.project_id, 'proud-forest-33537802');
  assert.deepEqual(status.baseline_tables, ['public.projects', 'public.tasks', 'public.atlas_events']);
  assert.deepEqual(status.cleanup_branch_ids, ['br-proof', 'br-preserved']);
  assert.equal(status.cleanup_verified, true);
});
