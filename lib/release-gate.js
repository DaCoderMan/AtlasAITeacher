function runtimeCommitSha() {
  return process.env.ATLAS_RELEASE_GATE_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || null;
}

function runtimeDeploymentId() {
  return process.env.ATLAS_RELEASE_GATE_DEPLOYMENT_ID
    || process.env.VERCEL_DEPLOYMENT_ID
    || null;
}

function releaseGateMode() {
  const mode = String(process.env.ATLAS_RELEASE_GATE_MODE || 'off').toLowerCase();
  return ['off', 'monitor', 'enforce'].includes(mode) ? mode : 'off';
}

function isProductionDeployment() {
  return process.env.VERCEL_ENV === 'production';
}

export function getReleaseGateStatus() {
  const mode = releaseGateMode();
  const production = isProductionDeployment();
  const enforced = production && mode === 'enforce';
  const evidence = {
    commit: runtimeCommitSha(),
    deployment: runtimeDeploymentId(),
    tests: process.env.ATLAS_RELEASE_GATE_TESTS || null,
    tested_at: process.env.ATLAS_RELEASE_GATE_TESTED_AT || null,
    production_readback: process.env.ATLAS_RELEASE_GATE_PRODUCTION_READBACK || null,
    approved_at: process.env.ATLAS_RELEASE_GATE_APPROVED_AT || null,
    approver: process.env.ATLAS_RELEASE_GATE_APPROVER || null
  };
  const missing = [];
  if (mode !== 'off') {
    if (!evidence.commit) missing.push('commit');
    if (!evidence.deployment) missing.push('deployment');
    if (!evidence.tests) missing.push('tests');
    if (!evidence.tested_at) missing.push('tested_at');
  }
  const blocked = enforced && missing.length > 0;
  return {
    policy: 'atlas-release-gate.v1',
    mode,
    production,
    enforced,
    allow_requests: !blocked,
    status: mode === 'off' ? 'disabled' : blocked ? 'blocked' : enforced ? 'open' : 'monitor',
    summary: mode === 'off'
      ? 'release gate disabled'
      : blocked
        ? `release gate blocked: missing ${missing.join(', ')}`
        : enforced
          ? 'release gate open'
          : 'release gate monitoring only',
    missing_requirements: missing,
    evidence
  };
}

export function assertReleaseGateOpen() {
  const gate = getReleaseGateStatus();
  if (!gate.allow_requests) {
    const error = new Error('release_gate_blocked');
    error.status = 503;
    error.release_gate = gate;
    throw error;
  }
  return gate;
}
