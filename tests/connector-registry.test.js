import test from 'node:test';
import assert from 'node:assert/strict';
import { listConnectorDefinitions } from '../lib/connector-registry.js';

test('connector registry definitions include canonical connector metadata fields', () => {
  const connectors = listConnectorDefinitions();
  assert.ok(connectors.length >= 8);
  const github = connectors.find(item => item.id === 'github');
  assert.equal(github.provider, 'github');
  assert.ok(github.capabilities.includes('pull_requests'));
  assert.ok(github.risk_classes.includes('engineering'));
  assert.equal(github.pagination_mode, 'cursor');
  assert.equal(github.execution_plane, 'connector');
});
