import crypto from 'node:crypto';

export function buildSyncIdempotencyKey(route = {}) {
  const stable = [route.event_id || '', route.extraction_id || '', route.destination || '', route.action || ''].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

export function assertBulkReplayAllowed(canaries = {}) {
  const notion = canaries.notion === true;
  const github = canaries.github === true;
  if (!notion || !github) {
    throw new Error('bulk replay blocked: verified Notion and GitHub canaries are required');
  }
  return true;
}

export async function stageSyncDelivery(client, route, payload, { userId, mode = 'normal', provenance = {} } = {}) {
  if (!client) throw new Error('client is required');
  if (!userId) throw new Error('userId is required');
  if (!route?.id || !route?.event_id || !route?.destination || !route?.action) throw new Error('route identity is incomplete');

  const idempotencyKey = buildSyncIdempotencyKey(route);
  const inserted = await client.query(`
    INSERT INTO atlas_sync_deliveries(
      user_id, route_id, event_id, extraction_id, destination, action,
      idempotency_key, mode, request_payload, provenance
    ) VALUES ($1,$2::uuid,$3::uuid,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
    ON CONFLICT (route_id) DO NOTHING
    RETURNING id::text, status, attempts, destination_ref, readback_at
  `, [
    userId, route.id, route.event_id, route.extraction_id || '', route.destination, route.action,
    idempotencyKey, mode, JSON.stringify(payload || {}), JSON.stringify(provenance || {})
  ]);

  let delivery = inserted.rows[0];
  if (!delivery) {
    const existing = await client.query(`
      SELECT id::text, status, attempts, destination_ref, readback_at
      FROM atlas_sync_deliveries
      WHERE route_id=$1::uuid
    `, [route.id]);
    if (!existing.rows.length) throw new Error('sync delivery idempotency readback failed');
    delivery = existing.rows[0];
  }

  await client.query(`UPDATE atlas_routing_log SET sync_delivery_id=$2::uuid WHERE id=$1::uuid`, [route.id, delivery.id]);
  return { ...delivery, idempotency_key: idempotencyKey, duplicate: inserted.rows.length === 0 };
}

export async function markSyncAttempt(client, deliveryId) {
  const { rows } = await client.query(`
    UPDATE atlas_sync_deliveries
    SET attempts=attempts+1, locked_at=now(), updated_at=now()
    WHERE id=$1::uuid
    RETURNING id::text, attempts
  `, [deliveryId]);
  if (!rows.length) throw new Error('sync delivery not found');
  return rows[0];
}

export async function markSyncDelivered(client, deliveryId, { destinationRef = null, response = {} } = {}) {
  await client.query(`
    UPDATE atlas_sync_deliveries
    SET status='delivered', destination_ref=COALESCE($2,destination_ref),
        response_payload=$3::jsonb, delivered_at=now(), locked_at=NULL,
        last_error=NULL, updated_at=now()
    WHERE id=$1::uuid
  `, [deliveryId, destinationRef, JSON.stringify(response || {})]);
}

export async function markSyncFailed(client, deliveryId, error) {
  await client.query(`
    UPDATE atlas_sync_deliveries
    SET status='retry', locked_at=NULL, last_error=$2,
        available_at=now(), updated_at=now()
    WHERE id=$1::uuid
  `, [deliveryId, String(error?.message || error)]);
}

export async function recordSyncReadback(client, deliveryId, { verified, payload = {}, destinationRef = null } = {}) {
  const status = verified ? 'verified' : 'readback_failed';
  const { rows } = await client.query(`
    UPDATE atlas_sync_deliveries
    SET status=$2, readback_payload=$3::jsonb,
        destination_ref=COALESCE($4,destination_ref), readback_at=now(), updated_at=now()
    WHERE id=$1::uuid
    RETURNING id::text, status, destination, destination_ref, readback_at
  `, [deliveryId, status, JSON.stringify(payload || {}), destinationRef]);
  if (!rows.length) throw new Error('sync delivery not found');
  return rows[0];
}
