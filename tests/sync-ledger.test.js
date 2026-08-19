import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncIdempotencyKey, assertBulkReplayAllowed, stageSyncDelivery } from '../lib/sync-ledger.js';

test('sync idempotency key is deterministic and route-semantic', () => {
  const route = { event_id: 'e1', extraction_id: 'x1', destination: 'notion', action: 'upsert' };
  assert.equal(buildSyncIdempotencyKey(route), buildSyncIdempotencyKey({ ...route }));
  assert.notEqual(buildSyncIdempotencyKey(route), buildSyncIdempotencyKey({ ...route, destination: 'github' }));
});

test('bulk replay is blocked until both destination canaries are verified', () => {
  assert.throws(() => assertBulkReplayAllowed({ notion: true, github: false }), /bulk replay blocked/);
  assert.throws(() => assertBulkReplayAllowed({ notion: false, github: true }), /bulk replay blocked/);
  assert.equal(assertBulkReplayAllowed({ notion: true, github: true }), true);
});

test('staging the same route twice reuses the durable delivery', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO atlas_sync_deliveries')) {
        if (calls.filter(c => c.sql.includes('INSERT INTO atlas_sync_deliveries')).length === 1) {
          return { rows: [{ id: 'd1', status: 'pending', attempts: 0, destination_ref: null, readback_at: null }] };
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT id::text, status')) return { rows: [{ id: 'd1', status: 'pending', attempts: 0, destination_ref: null, readback_at: null }] };
      if (sql.includes('UPDATE atlas_routing_log')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const route = { id: '00000000-0000-0000-0000-000000000001', event_id: '00000000-0000-0000-0000-000000000002', extraction_id: null, destination: 'notion', action: 'upsert' };
  const first = await stageSyncDelivery(db, route, { hello: 'world' }, { userId: 'u1', mode: 'canary' });
  const second = await stageSyncDelivery(db, route, { hello: 'world' }, { userId: 'u1', mode: 'canary' });
  assert.equal(first.id, 'd1');
  assert.equal(first.duplicate, false);
  assert.equal(second.id, 'd1');
  assert.equal(second.duplicate, true);
  assert.equal(first.idempotency_key, second.idempotency_key);
});
