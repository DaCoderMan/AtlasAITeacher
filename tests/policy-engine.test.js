import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../lib/policy-engine.js';

test('low-value extraction is ignored automatically', () => {
  const result = evaluatePolicy({ extraction: { kind: 'note', importance: 20, confidence: 0.9 } });
  assert.equal(result.decision, 'ignore');
  assert.equal(result.requires_review, false);
});

test('normal high-confidence task is auto-routed', () => {
  const result = evaluatePolicy({ extraction: { kind: 'task', importance: 75, confidence: 0.8 } });
  assert.equal(result.decision, 'auto');
  assert.equal(result.requires_review, false);
});

test('calendar commitment stays under review unless confidence is very high', () => {
  const result = evaluatePolicy({ extraction: { kind: 'commitment_candidate', importance: 80, confidence: 0.8 } });
  assert.equal(result.decision, 'review');
  assert.equal(result.requires_review, true);
});

test('sensitive durable data is persisted privately', () => {
  const result = evaluatePolicy({
    extraction: { kind: 'memory_candidate', importance: 80, confidence: 0.9 },
    event: { sensitivity: 'highly_sensitive' }
  });
  assert.equal(result.decision, 'persist_private');
});
