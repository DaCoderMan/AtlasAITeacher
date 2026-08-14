import pg from 'pg';
import { ingestEvent } from './ingestion.js';
import { atlasLifecycle } from './manifests.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

function userId() {
  return process.env.ATLAS_USER_ID || 'default';
}

function clampLimit(limit, fallback = 20) {
  const n = Number(limit || fallback);
  return Math.max(1, Math.min(100, Number.isFinite(n) ? n : fallback));
}

export async function atlasSearch({ query, limit = 20 } = {}) {
  if (!query?.trim()) throw new Error('query is required');
  const q = `%${query.trim()}%`;
  const n = clampLimit(limit);
  const client = await pool.connect();
  try {
    const [projects, tasks, extractions] = await Promise.all([
      client.query(`
        SELECT id::text, name, manifest_id, lifecycle, last_verified_at, objective, status, priority, next_action, blockers, updated_at
        FROM projects
        WHERE user_id=$1 AND deleted_at IS NULL
          AND (name ILIKE $2 OR COALESCE(manifest_id,'') ILIKE $2 OR COALESCE(objective,'') ILIKE $2 OR COALESCE(next_action,'') ILIKE $2)
        ORDER BY priority DESC, updated_at DESC LIMIT $3
      `, [userId(), q, n]),
      client.query(`
        SELECT id::text, project_id::text, title, description, status, priority, due_at, blocker, updated_at
        FROM tasks
        WHERE user_id=$1 AND deleted_at IS NULL
          AND (title ILIKE $2 OR COALESCE(description,'') ILIKE $2 OR COALESCE(blocker,'') ILIKE $2)
        ORDER BY priority DESC, updated_at DESC LIMIT $3
      `, [userId(), q, n]),
      client.query(`
        SELECT id::text, kind, title, body, importance, confidence, created_at
        FROM atlas_extractions
        WHERE user_id=$1 AND (COALESCE(title,'') ILIKE $2 OR COALESCE(body,'') ILIKE $2)
        ORDER BY importance DESC, created_at DESC LIMIT $3
      `, [userId(), q, n])
    ]);
    return { query, projects: projects.rows, tasks: tasks.rows, extractions: extractions.rows };
  } finally {
    client.release();
  }
}

export async function atlasProjects({ status, lifecycle, manifest_id, limit = 50 } = {}) {
  const n = clampLimit(limit, 50);
  const params = [userId()];
  let filter = '';
  if (status) { params.push(status); filter += ` AND status=$${params.length}`; }
  if (lifecycle) { params.push(lifecycle); filter += ` AND lifecycle=$${params.length}`; }
  if (manifest_id) { params.push(manifest_id); filter += ` AND manifest_id=$${params.length}`; }
  params.push(n);
  const { rows } = await pool.query(`
    SELECT id::text, name, manifest_id, lifecycle, last_verified_at, objective, status, priority, next_action, blockers, external_links, updated_at
    FROM projects
    WHERE user_id=$1 AND deleted_at IS NULL${filter}
    ORDER BY priority DESC, updated_at DESC
    LIMIT $${params.length}
  `, params);
  return rows;
}

export async function atlasTasks({ status, project_id, limit = 50 } = {}) {
  const n = clampLimit(limit, 50);
  const params = [userId()];
  let filter = '';
  if (status) { params.push(status); filter += ` AND status=$${params.length}`; }
  if (project_id) { params.push(project_id); filter += ` AND project_id=$${params.length}::uuid`; }
  params.push(n);
  const { rows } = await pool.query(`
    SELECT id::text, project_id::text, title, description, status, priority,
           due_at, scheduled_start, scheduled_end, blocker, source, updated_at
    FROM tasks
    WHERE user_id=$1 AND deleted_at IS NULL${filter}
    ORDER BY priority DESC, COALESCE(due_at, 'infinity'::timestamptz), updated_at DESC
    LIMIT $${params.length}
  `, params);
  return rows;
}

export async function atlasContext({ project, query, limit = 20 } = {}) {
  const n = clampLimit(limit);
  const params = [userId()];
  let projectFilter = '';
  if (project) {
    params.push(`%${project}%`);
    projectFilter = ` AND (name ILIKE $${params.length} OR COALESCE(manifest_id,'') ILIKE $${params.length})`;
  }
  params.push(Math.min(n, 20));
  const projects = await pool.query(`
    SELECT id::text, name, manifest_id, lifecycle, last_verified_at, objective, status, priority, next_action, blockers, updated_at
    FROM projects WHERE user_id=$1 AND deleted_at IS NULL${projectFilter}
    ORDER BY priority DESC, updated_at DESC LIMIT $${params.length}
  `, params);

  const projectIds = projects.rows.map(p => p.id);
  const tasks = projectIds.length
    ? await pool.query(`
        SELECT id::text, project_id::text, title, description, status, priority, due_at, scheduled_start, scheduled_end, blocker, updated_at
        FROM tasks
        WHERE user_id=$1 AND deleted_at IS NULL AND project_id = ANY($2::uuid[])
        ORDER BY priority DESC, COALESCE(due_at, 'infinity'::timestamptz), updated_at DESC LIMIT $3
      `, [userId(), projectIds, n])
    : { rows: [] };

  let search = null;
  if (query?.trim()) search = await atlasSearch({ query, limit: n });

  const recent = await pool.query(`
    SELECT kind, title, body, importance, confidence, created_at
    FROM atlas_extractions
    WHERE user_id=$1
    ORDER BY importance DESC, created_at DESC LIMIT $2
  `, [userId(), Math.min(n, 20)]);

  return { projects: projects.rows, tasks: tasks.rows, recent_extractions: recent.rows, search };
}

export async function atlasStatus() {
  const [projects, lifecycles, tasks, routing] = await Promise.all([
    pool.query(`SELECT status, count(*)::int AS count FROM projects WHERE user_id=$1 AND deleted_at IS NULL GROUP BY status`, [userId()]),
    pool.query(`SELECT COALESCE(lifecycle,'Unmapped') AS lifecycle, count(*)::int AS count FROM projects WHERE user_id=$1 AND deleted_at IS NULL GROUP BY COALESCE(lifecycle,'Unmapped')`, [userId()]),
    pool.query(`SELECT status, count(*)::int AS count FROM tasks WHERE user_id=$1 AND deleted_at IS NULL GROUP BY status`, [userId()]),
    pool.query(`SELECT status, count(*)::int AS count FROM atlas_routing_log WHERE event_id IN (SELECT id FROM atlas_events WHERE user_id=$1) GROUP BY status`, [userId()])
  ]);
  const top = await pool.query(`
    SELECT id::text, project_id::text, title, priority, due_at, status
    FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND status <> 'done'
    ORDER BY priority DESC, COALESCE(due_at, 'infinity'::timestamptz), updated_at DESC LIMIT 10
  `, [userId()]);
  return { projects: projects.rows, project_lifecycles: lifecycles.rows, tasks: tasks.rows, routing: routing.rows, top_tasks: top.rows };
}

export async function atlasCreateTask({ title, description, project_id, priority = 3, due_at } = {}) {
  if (!title?.trim()) throw new Error('title is required');
  const { rows } = await pool.query(`
    INSERT INTO tasks(user_id, project_id, title, description, priority, due_at, source)
    VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, NULLIF($6,'')::timestamptz, 'atlas_mcp')
    RETURNING id::text, project_id::text, title, description, status, priority, due_at, source, created_at
  `, [userId(), project_id || '', title.trim(), description || null, Math.max(1, Math.min(5, Number(priority) || 3)), due_at || '']);
  await ingestEvent({ source: 'atlas_mcp', source_event_id: `task:${rows[0].id}`, content_text: `Created task: ${rows[0].title}`, content_json: rows[0], actor: 'atlas' });
  return rows[0];
}

export async function atlasUpdateProject({ project_id, status, lifecycle, priority, next_action, blockers, objective } = {}) {
  if (!project_id) throw new Error('project_id is required');
  if (lifecycle !== undefined && lifecycle !== null && !atlasLifecycle().includes(lifecycle)) throw new Error(`invalid project lifecycle: ${lifecycle}`);
  const { rows } = await pool.query(`
    UPDATE projects SET
      status=COALESCE($3,status),
      lifecycle=CASE WHEN $4::boolean THEN $5 ELSE lifecycle END,
      priority=COALESCE($6,priority),
      next_action=CASE WHEN $7::boolean THEN $8 ELSE next_action END,
      blockers=CASE WHEN $9::boolean THEN $10 ELSE blockers END,
      objective=CASE WHEN $11::boolean THEN $12 ELSE objective END,
      last_verified_at=now(),
      updated_at=now()
    WHERE id=$2::uuid AND user_id=$1 AND deleted_at IS NULL
    RETURNING id::text, name, manifest_id, lifecycle, last_verified_at, objective, status, priority, next_action, blockers, updated_at
  `, [userId(), project_id, status || null, lifecycle !== undefined, lifecycle ?? null,
      priority == null ? null : Math.max(1, Math.min(5, Number(priority))),
      next_action !== undefined, next_action ?? null, blockers !== undefined, blockers ?? null,
      objective !== undefined, objective ?? null]);
  if (!rows.length) throw new Error('project not found');
  await ingestEvent({
    source: 'atlas_mcp',
    source_event_id: `project-update:${project_id}:${Date.now()}`,
    content_text: `Project update: ${rows[0].name}. Status ${rows[0].status}. Lifecycle ${rows[0].lifecycle || 'unmapped'}. Next action: ${rows[0].next_action || 'none'}`,
    content_json: rows[0], actor: 'atlas', project_hint: rows[0].name
  });
  return rows[0];
}

export async function atlasRemember({ text, project_hint, sensitivity = 'normal', source = 'atlas_mcp' } = {}) {
  if (!text?.trim()) throw new Error('text is required');
  return ingestEvent({ source, content_text: text, project_hint: project_hint || null, sensitivity, actor: 'atlas' });
}

export async function closeAtlasStorePool() {
  await pool.end();
}
