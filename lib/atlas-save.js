import crypto from 'node:crypto';
import pg from 'pg';
import { enqueueSourceEvent, processQueuedEvents } from './auto-ingest.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

function stableEventId({ source, source_event_id, thread_id, text }) {
  if (source_event_id) return source_event_id;
  return `atlas-save:${crypto.createHash('sha256').update(JSON.stringify({ source, thread_id: thread_id || null, text })).digest('hex')}`;
}

function backupState(rows) {
  const drive = rows.filter(r => /drive/i.test(String(r.destination || '')));
  if (!drive.length) return { required: true, state: 'pending', reason: 'no_drive_route_registered' };
  if (drive.some(r => r.status === 'verified' || r.readback_at)) return { required: true, state: 'verified', routes: drive };
  if (drive.some(r => ['failed', 'dead_letter'].includes(r.status))) return { required: true, state: 'failed', routes: drive };
  return { required: true, state: 'pending', routes: drive };
}

async function checkpoint({ eventId, source, threadId, worker, verification, backup }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resumeHandle = `atlas-save:${source}:${threadId || 'default'}`;
    const { rows: sessions } = await client.query(`
      INSERT INTO atlas_sessions(user_id, project_key, status, current_version, resume_handle, context)
      VALUES ($1,'atlas','active',0,$2,$3::jsonb)
      ON CONFLICT (resume_handle)
      DO UPDATE SET status='active', context=atlas_sessions.context || EXCLUDED.context, updated_at=now()
      RETURNING id::text, current_version
    `, [userId(), resumeHandle, JSON.stringify({ source, thread_id: threadId || null, last_event_id: eventId })]);

    const session = sessions[0];
    const nextVersion = Number(session.current_version || 0) + 1;
    const state = {
      event_id: eventId,
      source,
      thread_id: threadId || null,
      worker,
      verification,
      backup,
      policy: 'atlas.save.policy.v1'
    };
    const { rows: cps } = await client.query(`
      INSERT INTO atlas_session_checkpoints(session_id,user_id,checkpoint_version,expected_canonical_version,delta,checkpoint_state,causal_links)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
      ON CONFLICT (session_id, checkpoint_version)
      DO UPDATE SET delta=EXCLUDED.delta, checkpoint_state=EXCLUDED.checkpoint_state, causal_links=EXCLUDED.causal_links
      RETURNING id::text
    `, [session.id, userId(), nextVersion, nextVersion - 1,
      JSON.stringify({ event_id: eventId }), JSON.stringify(state), JSON.stringify([eventId])]);

    await client.query(`
      UPDATE atlas_sessions
      SET current_version=$2, latest_checkpoint_id=$3::uuid, last_checkpoint_at=now(), updated_at=now()
      WHERE id=$1::uuid
    `, [session.id, nextVersion, cps[0].id]);
    await client.query('COMMIT');
    return { session_id: session.id, checkpoint_id: cps[0].id, checkpoint_version: nextVersion };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function atlasSave(args = {}) {
  const text = String(args.text || args.content_text || '').trim();
  if (!text) throw new Error('atlas_save requires text/content_text to persist');

  const source = args.source || 'chatgpt';
  const sourceEventId = stableEventId({ source, source_event_id: args.source_event_id, thread_id: args.thread_id, text });
  const queued = await enqueueSourceEvent({
    source,
    source_event_id: sourceEventId,
    thread_id: args.thread_id,
    session_id: args.session_id,
    actor: args.actor || 'user',
    occurred_at: args.occurred_at,
    content_type: args.content_type || 'conversation',
    content_text: text,
    project_hint: args.project_hint || 'atlas',
    sensitivity: args.sensitivity || 'normal',
    language: args.language,
    provenance: { ...(args.provenance || {}), command: 'Atlas Save', policy: 'atlas.save.policy.v1' }
  });

  const worker = await processQueuedEvents({ limit: Math.max(1, Math.min(Number(args.limit || 25), 100)) });
  const { rows: events } = await pool.query(`
    SELECT id::text, status, occurred_at, updated_at
    FROM atlas_events WHERE user_id=$1 AND source=$2 AND source_event_id=$3
    LIMIT 1
  `, [userId(), source, sourceEventId]);
  if (!events.length) {
    return { status: 'PARTIAL_FAILURE', queue_id: queued.id, source_event_id: sourceEventId, worker, error: 'event_not_persisted_after_worker' };
  }

  const event = events[0];
  const { rows: counts } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM atlas_extractions WHERE event_id=$1::uuid) AS extraction_count,
      (SELECT count(*)::int FROM atlas_routing_log WHERE event_id=$1::uuid) AS route_count
  `, [event.id]);
  const { rows: deliveries } = await pool.query(`
    SELECT destination,status,readback_at,destination_ref,last_error
    FROM atlas_sync_deliveries
    WHERE user_id=$1 AND event_id=$2::uuid
    ORDER BY created_at ASC
  `, [userId(), event.id]);

  const verification = {
    event_persisted: true,
    extraction_count: counts[0]?.extraction_count || 0,
    route_count: counts[0]?.route_count || 0
  };
  const backup = backupState(deliveries);
  const cp = await checkpoint({ eventId: event.id, source, threadId: args.thread_id || args.session_id, worker, verification, backup });

  const status = backup.state === 'verified' ? 'SAVED_VERIFIED' : 'SAVED_BACKUP_PENDING';
  return {
    status,
    policy: 'atlas.save.policy.v1',
    source_event_id: sourceEventId,
    event_id: event.id,
    queue_id: queued.id,
    checkpoint: cp,
    verification,
    backup,
    worker
  };
}

export async function closeAtlasSavePool() {
  await pool.end();
}
