import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

export async function reconcileAtlas({ staleSourceMinutes = 180 } = {}) {
  const started = await pool.query(`
    INSERT INTO atlas_reconciliation_runs(user_id, scope)
    VALUES ($1,'automation') RETURNING id::text
  `, [userId()]);
  const runId = started.rows[0].id;

  try {
    const [queue, routes, sources] = await Promise.all([
      pool.query(`
        SELECT status, count(*)::int AS count
        FROM atlas_ingest_queue
        WHERE user_id=$1
        GROUP BY status
      `, [userId()]),
      pool.query(`
        SELECT destination, status, count(*)::int AS count
        FROM atlas_routing_log r
        JOIN atlas_events e ON e.id=r.event_id
        WHERE e.user_id=$1
        GROUP BY destination, status
        ORDER BY destination, status
      `, [userId()]),
      pool.query(`
        SELECT source, enabled, health, last_seen_at, last_success_at, last_error,
               CASE WHEN enabled AND (last_seen_at IS NULL OR last_seen_at < now() - ($2::text || ' minutes')::interval)
                    THEN true ELSE false END AS stale
        FROM atlas_source_registry
        WHERE user_id=$1
        ORDER BY source
      `, [userId(), String(staleSourceMinutes)])
    ]);

    const summary = {
      queue: Object.fromEntries(queue.rows.map(r => [r.status, r.count])),
      routing: routes.rows,
      sources: sources.rows,
      problems: []
    };

    const dead = summary.queue.dead_letter || 0;
    if (dead) summary.problems.push({ type: 'dead_letter_queue', count: dead });
    for (const source of sources.rows) {
      if (source.stale) summary.problems.push({ type: 'stale_source', source: source.source });
      if (source.health === 'degraded') summary.problems.push({ type: 'degraded_source', source: source.source, error: source.last_error });
    }
    for (const route of routes.rows) {
      if (route.status === 'failed') summary.problems.push({ type: 'failed_routing', destination: route.destination, count: route.count });
    }

    await pool.query(`
      UPDATE atlas_reconciliation_runs
      SET status=$2, summary=$3::jsonb, finished_at=now()
      WHERE id=$1
    `, [runId, summary.problems.length ? 'attention' : 'ok', JSON.stringify(summary)]);

    return { run_id: runId, status: summary.problems.length ? 'attention' : 'ok', ...summary };
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
