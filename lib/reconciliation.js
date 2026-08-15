import pg from 'pg';
import { recoverStuckQueue } from './auto-ingest.js';
import { requeueDeferredRoutes } from './route-executor.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

async function upsertConflict({ entity_type, entity_key, competing_values, authority_reason }) {
  const { rows } = await pool.query(`
    INSERT INTO atlas_conflicts
      (user_id, entity_type, entity_key, sources, competing_values, proposed_value, authority_reason, status)
    VALUES ($1,$2,$3,'["neon"]'::jsonb,$4::jsonb,NULL,$5,'open')
    ON CONFLICT (user_id, entity_type, entity_key, status)
    DO UPDATE SET competing_values=EXCLUDED.competing_values,
                  authority_reason=EXCLUDED.authority_reason,
                  last_seen_at=now()
    RETURNING id::text
  `, [userId(), entity_type, entity_key, JSON.stringify(competing_values), authority_reason]);
  return rows[0]?.id || null;
}

async function detectDuplicateConflicts() {
  const [projects, tasks] = await Promise.all([
    pool.query(`
      SELECT lower(trim(name)) AS key, jsonb_agg(jsonb_build_object(
        'id',id::text,'name',name,'status',status,'priority',priority,'updated_at',updated_at
      ) ORDER BY updated_at DESC) AS values
      FROM projects
      WHERE user_id=$1 AND deleted_at IS NULL
      GROUP BY lower(trim(name))
      HAVING count(*) > 1
    `, [userId()]),
    pool.query(`
      SELECT COALESCE(project_id::text,'none') || ':' || lower(trim(title)) AS key,
             jsonb_agg(jsonb_build_object(
               'id',id::text,'project_id',project_id::text,'title',title,'status',status,'priority',priority,'updated_at',updated_at
             ) ORDER BY updated_at DESC) AS values
      FROM tasks
      WHERE user_id=$1 AND deleted_at IS NULL AND lower(COALESCE(status,'')) NOT IN ('done','cancelled','archived')
      GROUP BY COALESCE(project_id::text,'none'), lower(trim(title))
      HAVING count(*) > 1
    `, [userId()])
  ]);

  const conflicts = [];
  for (const row of projects.rows) {
    const id = await upsertConflict({
      entity_type: 'project_duplicate_candidate',
      entity_key: row.key,
      competing_values: row.values,
      authority_reason: 'Multiple non-deleted Neon projects share the same normalized name; requires review rather than destructive merge.'
    });
    conflicts.push({ conflict_id: id, entity_type: 'project_duplicate_candidate', entity_key: row.key, competing_values: row.values });
  }
  for (const row of tasks.rows) {
    const id = await upsertConflict({
      entity_type: 'task_duplicate_candidate',
      entity_key: row.key,
      competing_values: row.values,
      authority_reason: 'Multiple open Neon tasks share the same normalized title in the same project; requires review rather than destructive merge.'
    });
    conflicts.push({ conflict_id: id, entity_type: 'task_duplicate_candidate', entity_key: row.key, competing_values: row.values });
  }
  return conflicts;
}

export async function reconcileAtlas({ staleSourceMinutes = 180, repair = true } = {}) {
  const started = await pool.query(`
    INSERT INTO atlas_reconciliation_runs(user_id, scope)
    VALUES ($1,'atlas2') RETURNING id::text
  `, [userId()]);
  const runId = started.rows[0].id;

  try {
    const repairs = repair ? {
      queue: await recoverStuckQueue({ stale_minutes: 10 }),
      routes: await requeueDeferredRoutes({ include_failed: false, limit: 500 })
    } : { queue: { recovered: 0, items: [] }, routes: { requeued: 0, routes: [] } };

    const [queue, routes, sources, conflicts] = await Promise.all([
      pool.query(`
        SELECT status, count(*)::int AS count
        FROM atlas_ingest_queue
        WHERE user_id=$1
        GROUP BY status
      `, [userId()]),
      pool.query(`
        SELECT r.destination, r.status, count(*)::int AS count,
               min(r.created_at) AS oldest_at
        FROM atlas_routing_log r
        JOIN atlas_events e ON e.id=r.event_id
        WHERE e.user_id=$1
        GROUP BY r.destination, r.status
        ORDER BY r.destination, r.status
      `, [userId()]),
      pool.query(`
        SELECT source, enabled, health, last_seen_at, last_success_at, last_error,
               CASE WHEN enabled AND (last_seen_at IS NULL OR last_seen_at < now() - ($2::text || ' minutes')::interval)
                    THEN true ELSE false END AS stale
        FROM atlas_source_registry
        WHERE user_id=$1
        ORDER BY source
      `, [userId(), String(Math.max(5, Math.min(10080, Number(staleSourceMinutes) || 180)))]),
      detectDuplicateConflicts()
    ]);

    const summary = {
      queue: Object.fromEntries(queue.rows.map(r => [r.status, r.count])),
      routing: routes.rows,
      sources: sources.rows,
      conflicts,
      repairs,
      problems: []
    };

    const dead = summary.queue.dead_letter || 0;
    const processing = summary.queue.processing || 0;
    if (dead) summary.problems.push({ type: 'dead_letter_queue', count: dead });
    if (processing) summary.problems.push({ type: 'processing_queue_items', count: processing, note: 'May be healthy if workers are actively running; stale locks are recovered separately.' });
    for (const source of sources.rows) {
      if (source.enabled && source.stale) summary.problems.push({ type: 'stale_source', source: source.source });
      if (source.enabled && source.health === 'degraded') summary.problems.push({ type: 'degraded_source', source: source.source, error: source.last_error });
    }
    for (const route of routes.rows) {
      if (route.status === 'failed') summary.problems.push({ type: 'failed_routing', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'rate_limited') summary.problems.push({ type: 'rate_limited_connector', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'provider_offline') summary.problems.push({ type: 'provider_offline', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'permission_denied' || route.status === 'auth_required') summary.problems.push({ type: 'connector_auth_or_permission', destination: route.destination, status: route.status, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'schema_mismatch') summary.problems.push({ type: 'connector_schema_mismatch', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'waiting_connector') summary.problems.push({ type: 'waiting_connector', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
      if (route.status === 'review') summary.problems.push({ type: 'review_queue', destination: route.destination, count: route.count, oldest_at: route.oldest_at });
    }
    if (conflicts.length) summary.problems.push({ type: 'canonical_duplicate_candidates', count: conflicts.length });

    const status = summary.problems.length ? 'attention' : 'ok';
    await pool.query(`
      UPDATE atlas_reconciliation_runs
      SET status=$2, summary=$3::jsonb, finished_at=now()
      WHERE id=$1
    `, [runId, status, JSON.stringify(summary)]);

    return { run_id: runId, status, ...summary };
  } catch (error) {
    await pool.query(`
      UPDATE atlas_reconciliation_runs
      SET status='failed', summary=$2::jsonb, finished_at=now()
      WHERE id=$1
    `, [runId, JSON.stringify({ error: String(error?.message || error) })]);
    throw error;
  }
}

export async function closeReconciliationPool() {
  await pool.end();
}
