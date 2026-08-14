import pg from 'pg';
import { ingestEvent } from './ingestion.js';
import { evaluatePolicy } from './policy-engine.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

const userId = () => process.env.ATLAS_USER_ID || 'default';

export async function enqueueSourceEvent(event) {
  if (!event?.source) throw new Error('source is required');
  const key = event.source_event_id || `${event.source}:${event.thread_id || ''}:${event.occurred_at || ''}:${event.content_text || event.text || ''}`;
  const { rows } = await pool.query(`
    INSERT INTO atlas_ingest_queue(user_id, source, source_key, payload, status, available_at)
    VALUES ($1,$2,$3,$4::jsonb,'pending',now())
    ON CONFLICT (user_id, source, source_key)
    DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()
    RETURNING id::text, status
  `, [userId(), event.source, key, JSON.stringify(event)]);
  return rows[0];
}

async function claimBatch(limit = 25) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT id::text, payload
      FROM atlas_ingest_queue
      WHERE user_id=$1 AND status='pending' AND available_at <= now()
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    `, [userId(), limit]);
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
    SET status=$2, last_error=$3, processed_at=CASE WHEN $2='done' THEN now() ELSE processed_at END,
        updated_at=now(), locked_at=NULL,
        available_at=CASE WHEN $2='pending' THEN now() + interval '2 minutes' ELSE available_at END
    WHERE id=$1
  `, [id, status, error]);
}

export async function processQueuedEvents({ limit = 25 } = {}) {
  const claimed = await claimBatch(limit);
  const results = [];
  for (const item of claimed) {
    try {
      const result = await ingestEvent(item.payload);
      const policy = [];
      for (const extraction of result.extractions || []) {
        policy.push({ extraction_id: extraction.id, ...evaluatePolicy({ extraction, event: item.payload }) });
      }
      await pool.query(`
        INSERT INTO atlas_automation_audit(user_id, queue_id, event_id, action, result)
        VALUES ($1,$2,$3,'auto_ingest',$4::jsonb)
      `, [userId(), item.id, result.event_id, JSON.stringify({ policy, result })]);
      await markQueue(item.id, 'done');
      results.push({ queue_id: item.id, ok: true, event_id: result.event_id, policy });
    } catch (error) {
      const { rows } = await pool.query('SELECT attempts FROM atlas_ingest_queue WHERE id=$1', [item.id]);
      const attempts = rows[0]?.attempts || 1;
      await markQueue(item.id, attempts >= 5 ? 'dead_letter' : 'pending', String(error?.message || error));
      results.push({ queue_id: item.id, ok: false, error: String(error?.message || error) });
    }
  }
  return { processed: results.length, results };
}

export async function getAutomationStatus() {
  const { rows } = await pool.query(`
    SELECT status, count(*)::int AS count
    FROM atlas_ingest_queue
    WHERE user_id=$1
    GROUP BY status
  `, [userId()]);
  return Object.fromEntries(rows.map(r => [r.status, r.count]));
}

export async function closeAutoIngestPool() {
  await pool.end();
}
