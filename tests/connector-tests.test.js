import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorTestPlan, listConnectorTestPlans } from '../lib/connector-tests.js';

test('connector test plans define safe read probes and optional reversible write probes', () => {
  const neon = connectorTestPlan('neon');
  assert.equal(neon.read_test.safety, 'harmless_read');
  assert.equal(neon.write_test.safety, 'reversible_write');
  assert.equal(neon.write_test.cleanup_required, true);
});

test('connector test matrix includes known connector entries', () => {
  const plans = listConnectorTestPlans();
  assert.ok(plans.some(item => item.connector_id === 'github'));
  assert.ok(plans.some(item => item.connector_id === 'calendar'));
});
