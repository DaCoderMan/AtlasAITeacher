import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMutationProvenance, mutationSourceEventId, withMutationMetadata } from '../lib/mutation-metadata.js';

test('mutationSourceEventId is deterministic for idempotent writes', () => {
  assert.equal(mutationSourceEventId('atlas_remember', 'abc123'), 'mutation:atlas_remember:abc123');
  assert.equal(mutationSourceEventId('atlas_remember', ''), null);
});

test('mergeMutationProvenance preserves existing fields and adds mutation metadata', () => {
  const provenance = mergeMutationProvenance(
    { origin: 'test', verification_status: 'preexisting' },
    { operation: 'atlas_enqueue', idempotencyKey: 'queue-1', correlationId: 'corr-1' }
  );
  assert.equal(provenance.origin, 'test');
  assert.equal(provenance.mutation_operation, 'atlas_enqueue');
  assert.equal(provenance.idempotency_key, 'queue-1');
  assert.equal(provenance.correlation_id, 'corr-1');
  assert.equal(provenance.verification_status, 'preexisting');
  assert.equal(typeof provenance.intent_hash, 'string');
  assert.equal(provenance.intent_hash.length, 64);
});

test('withMutationMetadata defaults source_event_id and actor without clobbering explicit values', () => {
  const enriched = withMutationMetadata(
    { source: 'custom_source', text: 'hello', idempotency_key: 'remember-1', correlation_id: 'corr-2' },
    { operation: 'atlas_remember', defaultSource: 'atlas_mcp', defaultActor: 'atlas' }
  );
  assert.equal(enriched.source, 'custom_source');
  assert.equal(enriched.actor, 'atlas');
  assert.equal(enriched.source_event_id, 'mutation:atlas_remember:remember-1');
  assert.equal(enriched.provenance.mutation_operation, 'atlas_remember');
  assert.equal(enriched.provenance.idempotency_key, 'remember-1');
  assert.equal(enriched.provenance.correlation_id, 'corr-2');
});

test('withMutationMetadata keeps explicit source_event_id for upstream replay compatibility', () => {
  const enriched = withMutationMetadata(
    { source: 'github', source_event_id: 'gh-evt-1', idempotency_key: 'dup-key' },
    { operation: 'atlas_ingest', defaultActor: 'codex' }
  );
  assert.equal(enriched.source_event_id, 'gh-evt-1');
  assert.equal(enriched.provenance.idempotency_key, 'dup-key');
});
