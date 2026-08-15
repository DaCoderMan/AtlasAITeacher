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
