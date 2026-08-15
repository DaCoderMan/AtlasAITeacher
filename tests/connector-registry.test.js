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

test('atlas connectors expose schema lifecycle metadata for version drift detection', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/unused';
  const { atlasConnectors } = await import(`../lib/connector-registry.js?test=${Date.now()}`);
  const connectors = await atlasConnectors();
  const github = connectors.find(item => item.connector_id === 'github');
  assert.equal(github.schema_lineage.current_version, github.schema_version);
  assert.equal(github.schema_lineage.compatibility_epoch, '2026-08-15.cx004');
  assert.equal(github.schema_lineage.status, 'current');
});
