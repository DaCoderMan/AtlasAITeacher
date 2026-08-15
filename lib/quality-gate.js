function enumValue(raw, allowed, fallback) {
  const normalized = String(raw || fallback).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function booleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function numberEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hoursBetween(a, b) {
  return Math.max(0, (a.getTime() - b.getTime()) / 36e5);
}

function telemetryStatus(telemetry) {
  if (telemetry.latency_ms_p50 == null && telemetry.cost_per_1k_tokens == null) {
    return 'missing';
  }
  return 'available';
}

function controlDecision({
  requested,
  requireFreshEvidence,
  requireFloor,
  requireTelemetry,
  evidence,
  telemetry,
  mode,
  fallbackReason = 'quality_gate_blocked'
}) {
  if (!requested) {
    return {
      requested: false,
      enabled: false,
      status: 'disabled',
      reason: 'not_requested'
    };
  }
  if (mode === 'off') {
    return {
      requested: true,
      enabled: true,
      status: 'enabled',
      reason: 'quality_gate_off'
    };
  }

  const missing = [];
  if (requireFreshEvidence && !evidence.fresh) missing.push('fresh_quality_evidence');
  if (requireFloor && !evidence.meets_floor) missing.push('quality_floor');
  if (requireTelemetry && telemetry.status !== 'available') missing.push('telemetry');

  if (missing.length) {
    return {
      requested: true,
      enabled: false,
      status: mode === 'monitor' ? 'monitor_blocked' : 'blocked',
      reason: fallbackReason,
      missing_requirements: missing
    };
  }

  return {
    requested: true,
    enabled: true,
    status: 'enabled',
    reason: 'quality_gate_satisfied'
  };
}

export function getQualityGateStatus({ now = new Date().toISOString() } = {}) {
  const mode = enumValue(process.env.ATLAS_QUALITY_GATE_MODE, ['off', 'monitor', 'enforce'], 'enforce');
  const nowDate = new Date(now);
  const floor = numberEnv('ATLAS_QUALITY_FLOOR', 0.85);
  const maxAgeHours = Math.max(1, numberEnv('ATLAS_QUALITY_EVAL_MAX_AGE_HOURS', 168));
  const recordedAt = isoOrNull(process.env.ATLAS_QUALITY_EVAL_AT);
  const recordedDate = recordedAt ? new Date(recordedAt) : null;
  const ageHours = recordedDate ? hoursBetween(nowDate, recordedDate) : null;
  const score = numberEnv('ATLAS_QUALITY_EVAL_SCORE', null);
  const telemetry = {
    source: process.env.ATLAS_OPTIMIZATION_TELEMETRY_SOURCE || null,
    latency_ms_p50: numberEnv('ATLAS_OPTIMIZATION_LATENCY_MS_P50', null),
    cost_per_1k_tokens: numberEnv('ATLAS_OPTIMIZATION_COST_PER_1K_TOKENS', null)
  };
  telemetry.status = telemetryStatus(telemetry);

  const evidence = {
    eval_id: process.env.ATLAS_QUALITY_EVAL_ID || null,
    eval_at: recordedAt,
    max_age_hours: maxAgeHours,
    age_hours: ageHours == null ? null : Number(ageHours.toFixed(3)),
    score,
    floor,
    fresh: Boolean(recordedDate && ageHours <= maxAgeHours),
    meets_floor: Boolean(score != null && score >= floor)
  };

  const optimizationMode = enumValue(
    process.env.ATLAS_OPTIMIZATION_MODE,
    ['off', 'shadow', 'live'],
    'off'
  );
  const experimentalRoutingMode = enumValue(
    process.env.ATLAS_EXPERIMENTAL_ROUTING_MODE,
    ['off', 'shadow', 'live'],
    'off'
  );

  const controls = {
    optimizations: {
      mode: optimizationMode,
      ...controlDecision({
        requested: optimizationMode !== 'off',
        requireFreshEvidence: true,
        requireFloor: true,
        requireTelemetry: true,
        evidence,
        telemetry,
        mode,
        fallbackReason: 'optimization_requires_current_quality_evidence'
      })
    },
    experimental_routing: {
      mode: experimentalRoutingMode,
      ...controlDecision({
        requested: experimentalRoutingMode !== 'off',
        requireFreshEvidence: true,
        requireFloor: true,
        requireTelemetry: false,
        evidence,
        telemetry,
        mode,
        fallbackReason: 'experimental_routing_requires_current_quality_evidence'
      })
    },
    transcript_enrichment: {
      mode: booleanEnv('ATLAS_TRANSCRIPT_ENRICHMENT_ENABLED', false) ? 'live' : 'off',
      ...controlDecision({
        requested: booleanEnv('ATLAS_TRANSCRIPT_ENRICHMENT_ENABLED', false),
        requireFreshEvidence: true,
        requireFloor: true,
        requireTelemetry: false,
        evidence,
        telemetry,
        mode,
        fallbackReason: 'transcript_enrichment_requires_current_quality_evidence'
      })
    }
  };

  return {
    policy: 'atlas-quality-gate.v1',
    mode,
    evaluation: evidence,
    telemetry,
    controls
  };
}
