import crypto from 'node:crypto';

export function mutationSourceEventId(operation, idempotencyKey) {
  if (!operation || !idempotencyKey) return null;
  return `mutation:${operation}:${idempotencyKey}`;
}

export function mergeMutationProvenance(
  provenance = {},
  { operation, idempotencyKey, correlationId, verificationStatus = 'canonical_write_received' } = {}
) {
  const next = { ...(provenance || {}) };
  if (operation) next.mutation_operation = operation;
  if (idempotencyKey) next.idempotency_key = idempotencyKey;
  if (correlationId) next.correlation_id = correlationId;
  if (verificationStatus && !next.verification_status) next.verification_status = verificationStatus;
  if (operation && idempotencyKey && !next.intent_hash) {
    next.intent_hash = crypto.createHash('sha256').update(JSON.stringify({ operation, idempotencyKey })).digest('hex');
  }
  return next;
}

export function mutationAuditEnvelope({
  operation,
  beforeState = null,
  afterState = null,
  rollbackNote = null,
  verificationStatus = 'canonical_write_committed'
} = {}) {
  const beforeStateObject = beforeState && typeof beforeState === 'object' ? beforeState : null;
  const afterStateObject = afterState && typeof afterState === 'object' ? afterState : null;
  const beforeKeys = new Set(Object.keys(beforeStateObject || {}));
  const afterKeys = new Set(Object.keys(afterStateObject || {}));
  const changedFields = [...new Set([...beforeKeys, ...afterKeys])]
    .filter(key => JSON.stringify(beforeStateObject?.[key] ?? null) !== JSON.stringify(afterStateObject?.[key] ?? null))
    .sort();
  return {
    mutation_operation: operation || null,
    verification_status: verificationStatus,
    before_state: beforeStateObject,
    after_state: afterStateObject,
    changed_fields: changedFields,
    rollback_note: rollbackNote || null
  };
}

export function withMutationMetadata(
  input = {},
  { operation, defaultSource = null, defaultActor = null, verificationStatus } = {}
) {
  return {
    ...input,
    source: input.source || defaultSource,
    actor: input.actor || defaultActor,
    source_event_id: input.source_event_id || mutationSourceEventId(operation, input.idempotency_key),
    provenance: mergeMutationProvenance(input.provenance, {
      operation,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
      verificationStatus
    })
  };
}
