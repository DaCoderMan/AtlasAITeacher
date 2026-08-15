import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSystemHealth, listHealthServices } from '../lib/system-health.js';

test('system health services expose execution planes', () => {
  const services = listHealthServices();
  const neon = services.find(item => item.service_id === 'neon');
  const github = services.find(item => item.service_id === 'github');
  assert.equal(neon.execution_plane, 'server');
  assert.equal(github.execution_plane, 'connector');
});

test('system health returns plane summaries and an explicit unverified host surface', async () => {
  const health = await checkSystemHealth({ timeout_ms: 250 });
  assert.equal(typeof health.planes.atlas_backend.health, 'string');
  assert.equal(health.planes.atlas_backend.execution_plane, 'server');
  assert.equal(health.planes.connector_runtime.execution_plane, 'connector');
  assert.equal(health.planes.host_surface.execution_plane, 'host');
  assert.equal(health.planes.host_surface.health, 'unknown');
  assert.match(health.planes.host_surface.note, /not directly observable/i);
});
