import pg from 'pg';
import { evaluatePolicy } from './policy-engine.js';
import { classifyConnectorFailure, CONNECTOR_RETRYABLE_STATUSES } from './connector-state.js';
import { recordMutationJournal } from './mutation-journal.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

const WEBHOOK_ENV = {
  notion: 'ATLAS_ROUTE_NOTION_URL',
  drive: 'ATLAS_ROUTE_DRIVE_URL',
  github: 'ATLAS_ROUTE_GITHUB_URL',
  calendar: 'ATLAS_ROUTE_CALENDAR_URL',
  gmail: 'ATLAS_ROUTE_GMAIL_URL',
  chatgpt_memory: 'ATLAS_ROUTE_MEMORY_URL'
};

export function normalizeDestination(destination) {
  if (destination === 'calendar_review') return 'calendar';
  if (destination === 'chatgpt_memory_candidate') return 'chatgpt_memory';
  return destination;
}

export function destinationConfig(destination) {
  const normalized = normalizeDestination(destination);
  const env_name = WEBHOOK_ENV[normalized] || null;
  return { destination: normalized, env_name, configured: Boolean(env_name && process.env[env_name]) };
}

async function markRoute(id, status, details = {}, destinationRef = null) {
  await pool.query(`
    UPDATE atlas_routing_log
    SET status=$2,
        details=COALESCE(details,'{}'::jsonb) || $3::jsonb,
        destination_ref=COALESCE($4,destination_ref)
    WHERE id=$1
  `, [id, status, JSON.stringify(details), destinationRef]);
}

async function incrementAttempt(id) {
  await pool.query(`
    UPDATE atlas_routing_log
    SET details = jsonb_set(
      COALESCE(details,'{}'::jsonb),
      '{route_attempts}',
      to_jsonb(COALESCE((details->>'route_attempts')::int,0) + 1),
      true
    )
    WHERE id=$1
  `, [id]);
}

function validateWebhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('route webhook URL is invalid'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('route webhook must use HTTPS (HTTP is allowed only for localhost)');
  if (url.username || url.password) throw new Error('route webhook URL must not contain embedded credentials');
  return url.toString();
}

async function deliverWebhook(rawUrl, payload) {
  const url = validateWebhookUrl(rawUrl);
  const headers = { 'content-type': 'application/json', 'user-agent': 'atlas-route-executor/2' };
  if (process.env.ATLAS_ROUTE_SECRET) headers.authorization = `Bearer ${process.env.ATLAS_ROUTE_SECRET}`;
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.ATLAS_ROUTE_TIMEOUT_MS) || 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`route webhook ${response.status}: ${text.slice(0, 500)}`);
      error.responseStatus = response.status;
      throw error;
    }
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 500) }; }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function requeueDeferredRoutes({ include_failed = false, limit = 100 } = {}) {
  const statuses = include_failed
    ? ['waiting_connector', ...CONNECTOR_RETRYABLE_STATUSES]
    : ['waiting_connector'];
  const { rows } = await pool.query(`
    SELECT r.id::text, r.destination, r.status
    FROM atlas_routing_log r
    JOIN atlas_events e ON e.id=r.event_id
    WHERE e.user_id=$1 AND r.status = ANY($2::text[])
    ORDER BY r.created_at ASC
    LIMIT $3
  `, [userId(), statuses, Math.max(1, Math.min(500, Number(limit) || 100))]);

  const requeued = [];
  for (const route of rows) {
    const config = destinationConfig(route.destination);
    if (!config.configured) continue;
    await pool.query(`
      UPDATE atlas_routing_log
      SET status='pending', details=COALESCE(details,'{}'::jsonb) || $2::jsonb
      WHERE id=$1
    `, [route.id, JSON.stringify({ retry_requested_at: new Date().toISOString(), retry_from_status: route.status })]);
    await recordMutationJournal({
      operation: 'atlas_route_requeue',
      contentText: `Requeued ${config.destination} route ${route.id} from ${route.status}`,
      contentJson: { route_id: route.id, destination: config.destination, previous_status: route.status, next_status: 'pending' },
      rollbackNote: 'Restore the previous route status if the requeue decision was incorrect.'
    });
    requeued.push({ route_id: route.id, destination: config.destination, previous_status: route.status });
  }
  return { scanned: rows.length, requeued: requeued.length, routes: requeued };
}

export async function processPendingRoutes({ eventId = null, limit = 100 } = {}) {
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
  `, [userId(), eventId, Math.max(1, Math.min(500, Number(limit) || 100))]);

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
      await markRoute(route.id, 'done', { automated: true, policy, completed_at: new Date().toISOString() });
      await recordMutationJournal({
        operation: 'atlas_route_status_update',
        contentText: `Completed Neon route ${route.id} automatically`,
        contentJson: { route_id: route.id, destination, status: 'done', automated: true, policy },
        projectHint: route.project_hint || null,
        rollbackNote: 'Reset the route status if this automatic completion was incorrect.'
      });
      results.push({ route_id: route.id, destination, status: 'done' });
      continue;
    }

    if (policy.decision === 'ignore') {
      await markRoute(route.id, 'skipped', { automated: true, policy });
      await recordMutationJournal({
        operation: 'atlas_route_status_update',
        contentText: `Skipped route ${route.id} after policy evaluation`,
        contentJson: { route_id: route.id, destination, status: 'skipped', automated: true, policy },
        projectHint: route.project_hint || null,
        rollbackNote: 'Restore the route status to pending if this policy skip was incorrect.'
      });
      results.push({ route_id: route.id, destination, status: 'skipped' });
      continue;
    }

    if (policy.requires_review || route.destination.endsWith('_review') || route.destination.endsWith('_candidate')) {
      await markRoute(route.id, 'review', { automated: true, policy, review_reason: 'policy_or_destination_requires_review' });
      await recordMutationJournal({
        operation: 'atlas_route_status_update',
        contentText: `Moved route ${route.id} to review`,
        contentJson: { route_id: route.id, destination, status: 'review', automated: true, policy, review_reason: 'policy_or_destination_requires_review' },
        projectHint: route.project_hint || null,
        rollbackNote: 'Restore the route status to pending if the review gate was applied incorrectly.'
      });
      results.push({ route_id: route.id, destination, status: 'review' });
      continue;
    }

    const config = destinationConfig(route.destination);
    const url = config.env_name ? process.env[config.env_name] : null;
    if (!url) {
      await markRoute(route.id, 'waiting_connector', { automated: true, policy, missing_env: config.env_name || null });
      await recordMutationJournal({
        operation: 'atlas_route_status_update',
        contentText: `Route ${route.id} is waiting for connector configuration`,
        contentJson: { route_id: route.id, destination, status: 'waiting_connector', automated: true, policy, missing_env: config.env_name || null },
        projectHint: route.project_hint || null,
        rollbackNote: 'Restore the route status to pending after the connector is configured if this wait state was recorded incorrectly.'
      });
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

    try {
      await incrementAttempt(route.id);
      const delivered = await deliverWebhook(url, payload);
      const ref = delivered.body?.id || delivered.body?.url || delivered.body?.ref || null;
      await markRoute(route.id, 'done', { automated: true, policy, delivery: delivered, completed_at: new Date().toISOString(), error: null }, ref ? String(ref) : null);
      await recordMutationJournal({
        operation: 'atlas_connector_write',
        contentText: `Delivered ${destination} route ${route.id}`,
        contentJson: { route_id: route.id, destination, status: 'done', destination_ref: ref || null, delivery_status: delivered.status, automated: true, policy },
        projectHint: route.project_hint || null,
        rollbackNote: 'Restore the route status or compensate downstream if the connector write was later determined to be invalid.'
      });
      results.push({ route_id: route.id, destination, status: 'done', destination_ref: ref });
    } catch (error) {
      const message = String(error?.message || error);
      const classified = classifyConnectorFailure(error);
      await markRoute(route.id, classified.status, {
        automated: true,
        policy,
        error: message,
        failed_at: new Date().toISOString(),
        connector_state: classified.status,
        retryable: classified.retryable,
        failure_reason: classified.reason
      });
      await recordMutationJournal({
        operation: 'atlas_connector_write',
        contentText: `Connector write for route ${route.id} ended in ${classified.status}`,
        contentJson: {
          route_id: route.id,
          destination,
          status: classified.status,
          automated: true,
          policy,
          error: message,
          retryable: classified.retryable,
          failure_reason: classified.reason
        },
        projectHint: route.project_hint || null,
        rollbackNote: 'Restore the previous route status if connector failure classification was incorrect.'
      });
      results.push({ route_id: route.id, destination, status: classified.status, error: message, retryable: classified.retryable });
    }
  }

  return { processed: results.length, results };
}

export async function retryRoutes({ include_failed = true, limit = 100 } = {}) {
  const requeue = await requeueDeferredRoutes({ include_failed, limit });
  const processing = requeue.requeued ? await processPendingRoutes({ limit }) : { processed: 0, results: [] };
  return { requeue, processing };
}

export async function closeRouteExecutorPool() {
  await pool.end();
}
