import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashMutationIntent, mutationJournalEventId } from '../lib/mutation-journal.js';

test('mutation journal ids stay stable for idempotent and non-idempotent operations', () => {
  const hash = hashMutationIntent('atlas_route_record', { intent: 'route this' });
  assert.equal(mutationJournalEventId('atlas_update_task', 'dup-1', hash), 'mutation:atlas_update_task:dup-1');
  assert.equal(mutationJournalEventId('atlas_route_record', null, hash), `mutation:atlas_route_record:${hash}`);
});

test('control plane recent mutation query includes system mutation records', () => {
  const source = readFileSync(new URL('../lib/control-plane-store.js', import.meta.url), 'utf8');
  assert.match(source, /source IN \('atlas_mcp_mutation', 'atlas_system_mutation'\)/);
});

test('route executor and reconciliation persist mutation journal events for automation writes', () => {
  const routeExecutor = readFileSync(new URL('../lib/route-executor.js', import.meta.url), 'utf8');
  const reconciliation = readFileSync(new URL('../lib/reconciliation.js', import.meta.url), 'utf8');
  assert.match(routeExecutor, /operation: 'atlas_route_requeue'/);
  assert.match(routeExecutor, /operation: 'atlas_route_status_update'/);
  assert.match(routeExecutor, /operation: 'atlas_connector_write'/);
  assert.match(routeExecutor, /function checksum\(value\)/);
  assert.match(routeExecutor, /destination_checksum: destinationChecksum/);
  assert.match(reconciliation, /operation: 'atlas_reconcile'/);
});
