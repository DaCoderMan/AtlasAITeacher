const DEFAULT_THRESHOLDS = Object.freeze({
  autoPersistMinImportance: 50,
  autoRouteMinConfidence: 0.65,
  highImpactMinConfidence: 0.9
});

export function evaluatePolicy({ extraction, event = {}, thresholds = DEFAULT_THRESHOLDS }) {
  const sensitivity = event.sensitivity || 'normal';
  const importance = Number(extraction?.importance ?? event.importance ?? 0);
  const confidence = Number(extraction?.confidence ?? event.confidence ?? 0);
  const kind = extraction?.kind || 'unknown';

  const highImpact = ['commitment_candidate'].includes(kind);
  const restricted = ['restricted', 'highly_sensitive'].includes(sensitivity);

  if (importance < thresholds.autoPersistMinImportance) {
    return { decision: 'ignore', reason: 'below_importance_threshold', requires_review: false };
  }

  if (restricted) {
    return { decision: 'persist_private', reason: 'sensitive_content', requires_review: highImpact };
  }

  if (highImpact && confidence < thresholds.highImpactMinConfidence) {
    return { decision: 'review', reason: 'high_impact_low_confidence', requires_review: true };
  }

  if (confidence < thresholds.autoRouteMinConfidence) {
    return { decision: 'review', reason: 'low_confidence', requires_review: true };
  }

  return { decision: 'auto', reason: 'policy_pass', requires_review: false };
}

export { DEFAULT_THRESHOLDS };
