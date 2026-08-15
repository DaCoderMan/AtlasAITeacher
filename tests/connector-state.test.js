import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConnectorFailure, classifyConnectorRuntimeState } from '../lib/connector-state.js';

test('connector failure classifier normalizes auth permission rate limit and schema failures', () => {
  assert.equal(classifyConnectorFailure({ responseStatus: 401 }).status, 'auth_required');
  assert.equal(classifyConnectorFailure({ responseStatus: 403 }).status, 'permission_denied');
  assert.equal(classifyConnectorFailure({ responseStatus: 429 }).status, 'rate_limited');
  assert.equal(classifyConnectorFailure({ responseStatus: 422 }).status, 'schema_mismatch');
  assert.equal(classifyConnectorFailure({ responseStatus: 503 }).status, 'provider_offline');
});

test('connector runtime state reflects configured health and last error', () => {
  assert.equal(classifyConnectorRuntimeState({ configured: false, health: 'offline' }), 'waiting_connector');
  assert.equal(classifyConnectorRuntimeState({ configured: true, health: 'healthy' }), 'ready');
  assert.equal(classifyConnectorRuntimeState({ configured: true, health: 'unknown', last_error: 'permission denied' }), 'permission_denied');
});
