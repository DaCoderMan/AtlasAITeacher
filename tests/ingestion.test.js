import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateExtractionStructured, buildIngestionProvenance, classifyEvent, routingPlan } from '../lib/ingestion.js';

test('classifies task and project update from one interaction', () => {
  const result = classifyEvent({
    content_text: 'Todo: test authentication tomorrow for the Mage Agent Factory project.'
  });
  const kinds = new Set(result.extractions.map((x) => x.kind));
  assert.equal(kinds.has('task'), true);
  assert.equal(kinds.has('project_update'), true);
  assert.equal(kinds.has('commitment_candidate'), true);
  assert.ok(result.importance >= 75);
});

test('classifies durable preference as memory candidate', () => {
  const result = classifyEvent({
    content_text: 'From now on, always route durable files to Google Drive.'
  });
  assert.equal(result.extractions.some((x) => x.kind === 'memory_candidate'), true);
});

test('classifies a canonical architecture decision', () => {
  const result = classifyEvent({
    content_text: 'Decision: Neon is the canonical structured state for Atlas.'
  });
  assert.equal(result.extractions.some((x) => x.kind === 'decision'), true);
  assert.ok(result.importance >= 85);
});

test('does not manufacture high-value extractions from casual chat', () => {
  const result = classifyEvent({ content_text: 'Hello, how are you?' });
  assert.equal(result.extractions.length, 0);
  assert.equal(result.importance, 10);
});

test('routing keeps commitments behind calendar review', () => {
  assert.deepEqual(routingPlan({ kind: 'commitment_candidate' }), ['neon', 'calendar_review']);
});

test('routing keeps memory writes as candidates rather than silent product-memory writes', () => {
  assert.deepEqual(routingPlan({ kind: 'memory_candidate' }), ['neon', 'chatgpt_memory_candidate']);
});

test('artifact routes to durable file storage', () => {
  assert.deepEqual(routingPlan({ kind: 'artifact' }), ['neon', 'drive']);
});

test('ingestion provenance stamps v2 metadata and supersession lineage', () => {
  const classified = classifyEvent({
    source: 'github',
    source_event_id: 'evt-1',
    project_hint: 'atlas',
    content_text: 'Decision: keep Atlas canonical state in Neon.'
  });
  const provenance = buildIngestionProvenance({
    source: 'github',
    source_event_id: 'evt-1',
    project_hint: 'atlas',
    provenance: { original_id: 'evt-1' }
  }, {
    contentHash: 'hash-1',
    classified,
    existing: {
      id: 'event-1',
      provenance: { revision_count: 2, first_observed_at: '2026-08-14T12:00:00Z' }
    },
    revision: {
      id: 'rev-1',
      revised_at: '2026-08-15T10:00:00Z',
      content_hash: 'old-hash',
      provenance: { extractor_version: 'old' }
    }
  });
  assert.equal(provenance.ingestion_contract_version, 'atlas-universal-ingestion.v2');
  assert.equal(provenance.extractor_version, 'atlas-ingestion-v2.2026-08-15');
  assert.equal(provenance.source_event_key, 'github:evt-1');
  assert.equal(provenance.source_content_hash, 'hash-1');
  assert.equal(provenance.revision_count, 3);
  assert.equal(provenance.supersedes.revision_id, 'rev-1');
  assert.equal(provenance.original_id, 'evt-1');
  assert.equal(provenance.first_observed_at, '2026-08-14T12:00:00Z');
});

test('annotated extraction metadata carries duplicate cluster and pending route receipts', () => {
  const structured = annotateExtractionStructured({ repository: 'AtlasAITeacher' }, {
    eventId: 'event-1',
    sourceEventKey: 'github:evt-1',
    duplicateCluster: 'engineering_artifact:cluster-1',
    routeDestinations: ['neon', 'github']
  });
  assert.equal(structured.repository, 'AtlasAITeacher');
  assert.equal(structured._atlas.derived_from_event_id, 'event-1');
  assert.equal(structured._atlas.source_event_key, 'github:evt-1');
  assert.equal(structured._atlas.duplicate_cluster, 'engineering_artifact:cluster-1');
  assert.deepEqual(structured._atlas.route_receipts, [
    { destination: 'neon', status: 'pending' },
    { destination: 'github', status: 'pending' }
  ]);
});
