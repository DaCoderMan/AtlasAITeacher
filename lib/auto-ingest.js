import crypto from 'node:crypto';
import pg from 'pg';
import { ingestEvent } from './ingestion.js';
import { evaluatePolicy } from './policy-engine.js';
import { processPendingRoutes, requeueDeferredRoutes } from './route-executor.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

const userId = () => process.env.ATLAS_USER_ID || 'default';
const MAX_ATTEMPTS = () => Math.max(1, Math.min(20, Number(process.env.ATLAS_QUEUE_MAX_ATTEMPTS) || 5));

function stableSourceKey(event) {
  if (event.source_event_id) return String(event.source_event_id);
  const material = [event.source, event.thread_id || '', event.session_id || '', event.occurred_at || '', event.content_text || event.text || '', JSON.stringify(event.content_json || {})].join('|');
  return `sha256:${crypto.createHash('sha256').update(material).digest('hex')}`;
}

async function touchSource(source, { success = false, error = null } = {}) {
  await pool.query(`
    INSERT INTO atlas_source_registry(user_id, source, enabled, mode, health, last_seen_at, last_success_at, last_error)
    VALUES ($1,$2,true,'push',$3,now(),CASE WHEN $4 THEN now() ELSE NULL END,$5)
    ON CONFLICT (user_id, source)
    DO UPDATE SET last_seen_at=now(),
                  last_success_at=CASE WHEN $4 THEN now() ELSE atlas_source_registry.last_success_at END,
                  health=$3, last_error=$5, updated_at=now()
  `, [userId(), source, error ? 'degraded' : (success ? 'healthy' : 'receiving'), success, error]);
}

export async function enqueueSourceEvent(event) {
  if (!event?.source) throw new Error('source is required');
  const key = stableSourceKey(event);
  const { rows } = await pool.query(`
    INSERT INTO atlas_ingest_queue(user_id, source, source_key, payload, status, available_at)
    VALUES ($1,$2,$3,$4::jsonb,'pending',now())
    ON CONFLICT (user_id, source, source_key)
    DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()
    RETURNING id::text, status, attempts, available_at
  `, [userId(), event.source, key, JSON.stringify(event)]);
  await touchSource(event.source);
  return rows[0];
}

export async function recoverStuckQueue({ stale_minutes = 10 } = {}) {
  const stale = Math.max(1, Math.min(1440, Number(stale_minutes) || 10));
  const { rows } = await pool.query(`
    UPDATE atlas_ingest_queue q
    SET status=CASE WHEN attempts >= $3 THEN 'dead_letter' ELSE 'pending' END,
        locked_at=NULL,
        available_at=CASE WHEN attempts >= $3 THEN available_at ELSE now() END,
        last_error=COALESCE(last_error,'') || CASE WHEN COALESCE(last_error,'')='' THEN '' ELSE E'\n' END || 'Recovered stale processing lock',
        updated_at=now()
    WHERE user_id=$1 AND status='processing'
      AND locked_at < now() - ($2::text || ' minutes')::interval
    RETURNING id::text, source, status, attempts
  `, [userId(), String(stale), MAX_ATTEMPTS()]);
  return { recovered: rows.length, items: rows };
}

async function claimBatch(limit = 25) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT q.id::text, q.source, q.payload
      FROM atlas_ingest_queue q
      JOIN atlas_source_registry s ON s.user_id=q.user_id AND s.source=q.source
      WHERE q.user_id=$1 AND q.status='pending' AND q.available_at <= now() AND s.enabled=true
      ORDER BY q.created_at ASC
      FOR UPDATE OF q SKIP LOCKED
      LIMIT $2
    `, [userId(), Math.max(1, Math.min(100, Number(limit) || 25))]);
    if (rows.length) {
      await client.query(`
        UPDATE atlas_ingest_queue
        SET status='processing', attempts=attempts+1, locked_at=now(), updated_at=now()
        WHERE id = ANY($1::uuid[])
      `, [rows.map(r => r.id)]);
    }
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markQueue(id, status, error = null) {
  await pool.query(`
    UPDATE atlas_ingest_queue
    SET status=$2,
        last_error=$3,
        processed_at=CASE WHEN $2='done' THEN now() ELSE processed_at END,
        updated_at=now(),
        locked_at=NULL,
        available_at=CASE WHEN $2='pending'
          THEN now() + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(attempts-1,0)))::int)
          ELSE available_at END
    WHERE id=$1
  `, [id, status, error]);
}

export async function processQueuedEvents({ limit = 25, stale_minutes = 10 } = {}) {
  const recovery = await recoverStuckQueue({ stale_minutes });
  const requeuedRoutes = await requeueDeferredRoutes({ include_failed: false, limit: Math.max(100, Number(limit) || 25) });
  const claimed = await claimBatch(limit);
  const results = [];
  for (const item of claimed) {
    try {
      const result = await ingestEvent(item.payload);
      const policy = [];
      for (const extraction of result.extractions || []) {
        policy.push({ extraction_id: extraction.id, ...evaluatePolicy({ extraction, event: item.payload }) });
      }
      const routing = await processPendingRoutes({ eventId: result.event_id });
      await pool.query(`
        INSERT INTO atlas_automation_audit(user_id, queue_id, event_id, action, result)
        VALUES ($1,$2,$3,'auto_ingest',$4::jsonb)
      `, [userId(), item.id, result.event_id, JSON.stringify({ policy, routing, result })]);
      await markQueue(item.id, 'done');
      await touchSource(item.source, { success: true });
      results.push({ queue_id: item.id, ok: true, event_id: result.event_id, policy, routing });
    } catch (error) {
      const message = String(error?.message || error);
      const { rows } = await pool.query('SELECT attempts FROM atlas_ingest_queue WHERE id=$1', [item.id]);
      const attempts = rows[0]?.attempts || 1;
      await markQueue(item.id, attempts >= MAX_ATTEMPTS() ? 'dead_letter' : 'pending', message);
      await touchSource(item.source, { error: message });
      await pool.query(`
        INSERT INTO atlas_automation_audit(user_id, queue_id, action, result)
        VALUES ($1,$2,'auto_ingest_error',$3::jsonb)
      `, [userId(), item.id, JSON.stringify({ error: message, attempts })]);
      results.push({ queue_id: item.id, ok: false, error: message });
    }
  }

  const deferredRouting = requeuedRoutes.requeued
    ? await processPendingRoutes({ limit: Math.max(100, Number(limit) || 25) })
    : { processed: 0, results: [] };

  return { processed: results.length, results, recovery, deferred_routing: { requeue: requeuedRoutes, processing: deferredRouting } };
}

export async function getAutomationStatus() {
  const [queue, sources, routing, stuck] = await Promise.all([
    pool.query(`
      SELECT status, count(*)::int AS count
      FROM atlas_ingest_queue
      WHERE user_id=$1
      GROUP BY status
    `, [userId()]),
    pool.query(`
      SELECT source, enabled, mode, health, last_seen_at, last_success_at, last_error
      FROM atlas_source_registry
      WHERE user_id=$1
      ORDER BY source
    `, [userId()]),
    pool.query(`
      SELECT r.status, count(*)::int AS count
      FROM atlas_routing_log r
      JOIN atlas_events e ON e.id=r.event_id
      WHERE e.user_id=$1
      GROUP BY r.status
    `, [userId()]),
    pool.query(`
      SELECT count(*)::int AS count,
             min(locked_at) AS oldest_locked_at
      FROM atlas_ingest_queue
      WHERE user_id=$1 AND status='processing' AND locked_at < now() - interval '10 minutes'
    `, [userId()])
  ]);
  return {
    queue: Object.fromEntries(queue.rows.map(r => [r.status, r.count])),
    routing: Object.fromEntries(routing.rows.map(r => [r.status, r.count])),
    sources: sources.rows,
    stuck_processing: stuck.rows[0] || { count: 0, oldest_locked_at: null }
  };
}

export async function closeAutoIngestPool() {
  await pool.end();
}
