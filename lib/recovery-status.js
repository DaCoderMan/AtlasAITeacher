function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function csv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function getRecoveryStatus() {
  const last_proof_at = isoOrNull(process.env.ATLAS_RECOVERY_PROOF_AT);
  const baseline_tables = csv(process.env.ATLAS_RECOVERY_BASELINE_TABLES);
  const cleanup_branch_ids = csv(process.env.ATLAS_RECOVERY_CLEANUP_BRANCH_IDS);
  const strategy = process.env.ATLAS_RECOVERY_PROOF_STRATEGY || 'branch_clone_validation';
  const status = process.env.ATLAS_RECOVERY_PROOF_STATUS || (last_proof_at ? 'verified' : 'unverified');

  return {
    policy: 'atlas-recovery-status.v1',
    status,
    strategy,
    last_proof_at,
    project_id: process.env.ATLAS_RECOVERY_PROJECT_ID || null,
    main_branch_id: process.env.ATLAS_RECOVERY_MAIN_BRANCH_ID || null,
    proof_branch_id: process.env.ATLAS_RECOVERY_PROOF_BRANCH_ID || null,
    preserved_branch_id: process.env.ATLAS_RECOVERY_PRESERVED_BRANCH_ID || null,
    proof_compute_id: process.env.ATLAS_RECOVERY_PROOF_COMPUTE_ID || null,
    baseline_tables,
    baseline_counts: process.env.ATLAS_RECOVERY_BASELINE_COUNTS || null,
    reset_verification: process.env.ATLAS_RECOVERY_RESET_VERIFICATION || null,
    preserved_state_summary: process.env.ATLAS_RECOVERY_PRESERVED_STATE || null,
    cleanup_branch_ids,
    cleanup_verified: cleanup_branch_ids.length > 0,
    readback: process.env.ATLAS_RECOVERY_PROOF_READBACK || null
  };
}
