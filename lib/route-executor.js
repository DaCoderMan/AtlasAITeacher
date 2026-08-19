import pg from 'pg';
import { evaluatePolicy } from './policy-engine.js';
import { stageSyncDelivery, markSyncAttempt, markSyncDelivered, markSyncFailed, recordSyncReadback } from './sync-ledger.js';
import { hasFirstPartyRoute, deliverFirstParty } from './first-party-routes.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

const WEBHOOK_ENV = {
  notion: 'ATLAS_ROUTE_NOTION_URL',
  drive: 'ATLAS_ROUTE_DRIVE_URL',
  github: 'ATLAS_ROUTE_GITHUB_URL',
  calendar: 'ATLAS_ROUTE_CALENDAR_URL',
  chatgpt_memory: 'ATLAS_ROUTE_MEMORY_URL'
};

function normalizeDestination(destination) {
  if (destination === 'calendar_review') return 'calendar';
  if (destination === 'chatgpt_memory_candidate') return 'chatgpt_memory';
  return destination;
}

async function markRoute(id, status, details = {}, destinationRef = null) {
  await pool.query(`
    UPDATE atlas_routing_log
    SET status=$2, details=COALESCE(details,'{}'::jsonb) || $3::jsonb,
        destination_ref=COALESCE($4,destination_ref)
    WHERE id=$1
  `, [id, status, JSON.stringify(details), destinationRef]);
}

async function deliverWebhook(url, payload) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.ATLAS_ROUTE_SECRET) headers.authorization = `Bearer ${process.env.ATLAS_ROUTE_SECRET}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  if (!response.ok) throw new Error(`route webhook ${response.status}: ${text.slice(0, 500)}`);
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 500) }; }
  return { status: response.status, body };
}

function configuredRoute(destination) {
  if (hasFirstPartyRoute(destination)) return { type: 'first_party' };
  const envName = WEBHOOK_ENV[destination];
  const url = envName ? process.env[envName] : null;
  if (url) return { type: 'webhook', url };
  return { type: 'missing', envName };
}

async function emitExternal(destination, payload, routeConfig) {
  if (routeConfig.type === 'first_party') return deliverFirstParty(destination, payload);
  const delivered = await deliverWebhook(routeConfig.url, payload);
  const ref = delivered.body?.id || delivered.body?.url || delivered.body?.ref || null;
  return {
    destinationRef: ref ? String(ref) : null,
    response: delivered,
    readback: null
  };
}

export async function processPendingRoutes({ eventId = null, limit = 100, syncMode = 'normal' } = {}) {
  const { rows } = await pool.query(`
    SELECT r.id::text, r.event_id::text, r.extraction_id::text, r.destination, r.action,
           x.kind, x.title, x.body, x.structured, x.importance AS extraction_importance,
           x.confidence AS extraction_confidence,
           e.source, e.source_event_id, e.thread_id, e.project_hint, e.sensitivity,
           e.importance AS event_importance, e.confidence AS event_confidence, e.provenance
    FROM atlas_routing_log r
    JOIN atlas_events e ON e.id=r.event_id
    LEFT JOIN atlas_extractions x ON x.id=r.extraction_id
    WHERE e.user_id=$1 AND r.status='pending'
      AND ($2::uuid IS NULL OR r.event_id=$2::uuid)
    ORDER BY r.created_at ASC
    LIMIT $3
  `, [userId(), eventId, limit]);

  const results = [];
  for (const route of rows) {
    const extraction = {
      kind: route.kind,
      importance: route.extraction_importance,
      confidence: route.extraction_confidence
    };
    const event = {
      sensitivity: route.sensitivity,
      importance: route.event_importance,
      confidence: route.event_confidence
    };
    const policy = evaluatePolicy({ extraction, event });
    const destination = normalizeDestination(route.destination);

    if (route.destination === 'neon') {
      await markRoute(route.id, 'done', { automated: true, policy });
      results.push({ route_id: route.id, destination, status: 'done' });
      continue;
    }

    if (policy.decision === 'ignore') {
      await markRoute(route.id, 'skipped', { automated: true, policy });
      results.push({ route_id: route.id, destination, status: 'skipped' });
      continue;
    }

    if (policy.requires_review || route.destination.endsWith('_review') || route.destination.endsWith('_candidate')) {
      await markRoute(route.id, 'review', { automated: true, policy });
      results.push({ route_id: route.id, destination, status: 'review' });
      continue;
    }

    const routeConfig = configuredRoute(destination);
    if (routeConfig.type === 'missing') {
      await markRoute(route.id, 'waiting_connector', { automated: true, policy, missing_env: routeConfig.envName || null });
      results.push({ route_id: route.id, destination, status: 'waiting_connector' });
      continue;
    }

    const payload = {
      route_id: route.id,
      event_id: route.event_id,
      extraction_id: route.extraction_id,
      destination,
      action: route.action,
      extraction: { kind: route.kind, title: route.title, body: route.body, structured: route.structured },
      context: {
        source: route.source,
        source_event_id: route.source_event_id,
        thread_id: route.thread_id,
        project_hint: route.project_hint,
        sensitivity: route.sensitivity,
        provenance: route.provenance
      },
      policy
    };

    const syncRoute = { ...route, destination };
    let delivery;
    try {
      delivery = await stageSyncDelivery(pool, syncRoute, payload, {
        userId: userId(),
        mode: syncMode,
        provenance: { source: 'atlas_route_executor', transport: routeConfig.type, event_provenance: route.provenance || {} }
      });
    } catch (error) {
      await markRoute(route.id, 'failed', { automated: true, policy, sync_ledger_error: String(error?.message || error) });
      results.push({ route_id: route.id, destination, status: 'failed', error: String(error?.message || error) });
      continue;
    }

    if (delivery.status === 'delivered' || delivery.status === 'verified') {
      await markRoute(route.id, 'done', {
        automated: true,
        policy,
        sync_delivery_id: delivery.id,
        sync_status: delivery.status,
        duplicate_suppressed: true
      }, delivery.destination_ref || null);
      results.push({
        route_id: route.id,
        destination,
        status: 'done',
        sync_status: delivery.status,
        duplicate_suppressed: true,
        destination_ref: delivery.destination_ref || null
      });
      continue;
    }

    try {
      await markSyncAttempt(pool, delivery.id);
      const emitted = await emitExternal(destination, payload, routeConfig);
      await markSyncDelivered(pool, delivery.id, {
        destinationRef: emitted.destinationRef,
        response: emitted.response
      });

      let syncStatus = 'delivered_unverified';
      if (emitted.readback) {
        const readback = await recordSyncReadback(pool, delivery.id, {
          verified: emitted.readback.verified,
          payload: emitted.readback.payload,
          destinationRef: emitted.destinationRef
        });
        syncStatus = readback.status;
        if (!emitted.readback.verified) throw new Error(`${destination} first-party readback verification failed`);
      }

      await markRoute(route.id, 'done', {
        automated: true,
        policy,
        delivery: emitted.response,
        sync_delivery_id: delivery.id,
        sync_status: syncStatus,
        transport: routeConfig.type
      }, emitted.destinationRef);
      results.push({
        route_id: route.id,
        destination,
        status: 'done',
        sync_status: syncStatus,
        transport: routeConfig.type,
        destination_ref: emitted.destinationRef
      });
    } catch (error) {
      await markSyncFailed(pool, delivery.id, error);
      await markRoute(route.id, 'failed', {
        automated: true,
        policy,
        sync_delivery_id: delivery.id,
        error: String(error?.message || error)
      });
      results.push({ route_id: route.id, destination, status: 'failed', error: String(error?.message || error) });
    }
  }

  return { processed: results.length, results };
}

export async function closeRouteExecutorPool() {
  await pool.end();
}
