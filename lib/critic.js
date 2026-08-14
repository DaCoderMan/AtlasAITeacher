const VALID_STATUS = ['pass', 'pass_with_notes', 'fail'];

function finding(type, severity, message, details = {}) {
  return { type, severity, message, ...details };
}

function normalizeCriteria(criteria = []) {
  return criteria.map((item, index) => {
    if (typeof item === 'string') return { id: `criterion-${index + 1}`, text: item };
    return { id: item.id || `criterion-${index + 1}`, text: item.text || item.requirement || String(item) };
  });
}

export function runCriticQA({
  requirements = [],
  evidence = [],
  tests = [],
  resolved_context = null,
  claimed_project_id = null,
  dependencies = [],
  contradictions = []
} = {}) {
  const findings = [];
  const criteria = normalizeCriteria(requirements);
  const evidenceByCriterion = new Map();
  for (const item of evidence || []) {
    const ids = item.criterion_ids || (item.criterion_id ? [item.criterion_id] : []);
    for (const id of ids) {
      if (!evidenceByCriterion.has(id)) evidenceByCriterion.set(id, []);
      evidenceByCriterion.get(id).push(item);
    }
  }

  for (const criterion of criteria) {
    if (!(evidenceByCriterion.get(criterion.id)?.length)) {
      findings.push(finding('requirements_coverage', 'error', `No evidence covers ${criterion.id}: ${criterion.text}`, { criterion_id: criterion.id }));
    }
  }

  for (const test of tests || []) {
    const status = String(test.status || '').toLowerCase();
    if (['failed', 'fail', 'error'].includes(status)) findings.push(finding('test_result', 'error', `Test failed: ${test.name || test.id || 'unnamed test'}`, { test }));
    else if (!['passed', 'pass', 'ok', 'skipped'].includes(status)) findings.push(finding('test_result', 'warning', `Test result is unverified: ${test.name || test.id || 'unnamed test'}`, { test }));
  }

  const contextProject = resolved_context?.project?.id || null;
  if (claimed_project_id && contextProject && claimed_project_id !== contextProject) {
    findings.push(finding('scope_adherence', 'error', 'Claimed project does not match resolved project scope', { claimed_project_id, resolved_project_id: contextProject }));
  }

  for (const dependency of dependencies || []) {
    if (dependency.required !== false && dependency.health && dependency.health !== 'healthy') {
      findings.push(finding('degraded_dependency', dependency.health === 'unknown' ? 'warning' : 'error', `Required dependency ${dependency.service_id || dependency.id} is ${dependency.health}`, { dependency }));
    }
  }

  for (const contradiction of contradictions || []) {
    findings.push(finding('contradiction', contradiction.severity || 'error', contradiction.message || 'Contradictory state detected', { contradiction }));
  }

  if (resolved_context?.warnings?.some(w => w.type === 'verification_timestamp_missing')) {
    findings.push(finding('source_freshness', 'warning', 'Project context does not have a verified timestamp'));
  }

  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.filter(item => item.severity === 'warning').length;
  const status = errors ? 'fail' : warnings ? 'pass_with_notes' : 'pass';
  if (!VALID_STATUS.includes(status)) throw new Error('invalid QA status');

  return {
    status,
    summary: { requirements: criteria.length, findings: findings.length, errors, warnings },
    findings,
    checked_at: new Date().toISOString()
  };
}
