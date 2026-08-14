import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent, routingPlan } from '../lib/ingestion.js';

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
