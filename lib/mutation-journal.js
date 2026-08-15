import crypto from 'node:crypto';
import { ingestEvent } from './ingestion.js';
import { mutationAuditEnvelope } from './mutation-metadata.js';

export function hashMutationIntent(operation, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ operation, payload })).digest('hex');
}

export function mutationJournalEventId(operation, idempotencyKey, intentHash) {
  if (idempotencyKey) return `mutation:${operation}:${idempotencyKey}`;
  if (operation && intentHash) return `mutation:${operation}:${intentHash}`;
  return null;
}

export async function recordMutationJournal({
  source = 'atlas_system_mutation',
  operation,
  idempotencyKey = null,
  correlationId = null,
  payload = null,
  contentText,
  contentJson,
  projectHint = null,
  beforeState = null,
  rollbackNote = null,
  verificationStatus = 'canonical_write_committed',
  actor = 'atlas'
} = {}) {
  const intentHash = hashMutationIntent(operation, payload ?? contentJson ?? null);
  const audit = mutationAuditEnvelope({
    operation,
    beforeState,
    afterState: contentJson,
    rollbackNote,
    verificationStatus
  });
  return ingestEvent({
    source,
    source_event_id: mutationJournalEventId(operation, idempotencyKey, intentHash) || `${operation}:${Date.now()}`,
    content_text: contentText,
    content_json: contentJson,
    project_hint: projectHint || null,
    sensitivity: 'normal',
    actor,
    provenance: {
      mutation_operation: operation || null,
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      intent_hash: intentHash,
      verification_status: verificationStatus,
      before_state: audit.before_state,
      after_state: audit.after_state,
      changed_fields: audit.changed_fields,
      rollback_note: audit.rollback_note
    }
  });
}
