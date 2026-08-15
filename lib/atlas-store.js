import crypto from 'node:crypto';
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

function hashIntent(operation, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ operation, payload })).digest('hex');
}

function mutationEventId(operation, idempotencyKey) {
  if (!idempotencyKey) return null;
  return `mutation:${operation}:${idempotencyKey}`;
}

async function loadIdempotentMutation(operation, idempotencyKey, intentHash) {
  if (!idempotencyKey) return null;
  const sourceEventId = mutationEventId(operation, idempotencyKey);
  const { rows } = await pool.query(`
    SELECT content_json, provenance
    FROM atlas_events
    WHERE user_id=$1 AND source='atlas_mcp_mutation' AND source_event_id=$2
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId(), sourceEventId]);
  if (!rows.length) return null;
  const provenance = rows[0].provenance || {};
  if (provenance.intent_hash && provenance.intent_hash !== intentHash) {
    throw new Error('idempotency_key_reused_with_different_intent');
  }
  return rows[0].content_json || null;
}

async function recordMutationEvent({
  operation,
  idempotencyKey,
  correlationId,
  intentHash,
  contentText,
  contentJson,
  projectHint
}) {
  return ingestEvent({
    source: 'atlas_mcp_mutation',
    source_event_id: mutationEventId(operation, idempotencyKey) || `${operation}:${Date.now()}`,
    content_text: contentText,
    content_json: contentJson,
    project_hint: projectHint || null,
    sensitivity: 'normal',
    actor: 'atlas',
    provenance: {
      mutation_operation: operation,
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      intent_hash: intentHash,
      verification_status: 'canonical_write_committed'
    }
  });
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

export async function atlasCreateTask({ title, description, project_id, priority = 3, due_at, idempotency_key, correlation_id } = {}) {
  if (!title?.trim()) throw new Error('title is required');
  const payload = { title: title.trim(), description: description || null, project_id: project_id || null, priority: Math.max(1, Math.min(5, Number(priority) || 3)), due_at: due_at || null };
  const intentHash = hashIntent('atlas_create_task', payload);
  const existing = await loadIdempotentMutation('atlas_create_task', idempotency_key, intentHash);
  if (existing) return existing;
  const { rows } = await pool.query(`
    INSERT INTO tasks(user_id, project_id, title, description, priority, due_at, source)
    VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, NULLIF($6,'')::timestamptz, 'atlas_mcp')
    RETURNING id::text, project_id::text, title, description, status, priority, due_at, source, created_at
  `, [userId(), project_id || '', payload.title, payload.description, payload.priority, due_at || '']);
  await recordMutationEvent({
    operation: 'atlas_create_task',
    idempotencyKey: idempotency_key,
    correlationId: correlation_id,
    intentHash,
    contentText: `Created task: ${rows[0].title}`,
    contentJson: rows[0],
    projectHint: rows[0].project_id
  });
  return rows[0];
}

const TASK_STATUSES = new Set(['pending', 'in_progress', 'done', 'waiting', 'cancelled']);

function nullableTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return parsed.toISOString();
}

export async function atlasUpdateTask({
  task_id, title, description, status, priority, project_id, due_at,
  scheduled_start, scheduled_end, blocker, idempotency_key, correlation_id
} = {}) {
  if (!task_id) throw new Error('task_id is required');
  const supplied = { title, description, status, priority, project_id, due_at, scheduled_start, scheduled_end, blocker };
  if (!Object.values(supplied).some(value => value !== undefined)) throw new Error('at least one task field is required');
  if (status !== undefined && !TASK_STATUSES.has(status)) throw new Error(`invalid task status: ${status}`);
  if (title !== undefined && (!title || !String(title).trim())) throw new Error('title cannot be empty');
  if (priority !== undefined && (!Number.isInteger(Number(priority)) || Number(priority) < 1 || Number(priority) > 5)) {
    throw new Error('priority must be an integer between 1 and 5');
  }

  const due = due_at === undefined ? null : nullableTimestamp(due_at, 'due_at');
  const start = scheduled_start === undefined ? null : nullableTimestamp(scheduled_start, 'scheduled_start');
  const end = scheduled_end === undefined ? null : nullableTimestamp(scheduled_end, 'scheduled_end');
  const intentHash = hashIntent('atlas_update_task', {
    task_id, title, description, status,
    priority: priority === undefined ? undefined : Number(priority),
    project_id, due_at: due, scheduled_start: start, scheduled_end: end, blocker
  });
  const existing = await loadIdempotentMutation('atlas_update_task', idempotency_key, intentHash);
  if (existing) return existing;
  const current = await pool.query(`
    SELECT scheduled_start, scheduled_end
    FROM tasks
    WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL
  `, [task_id, userId()]);
  if (!current.rowCount) throw new Error('task not found');
  const effectiveStart = scheduled_start === undefined ? current.rows[0].scheduled_start : start;
  const effectiveEnd = scheduled_end === undefined ? current.rows[0].scheduled_end : end;
  if (effectiveStart && effectiveEnd && new Date(effectiveStart) > new Date(effectiveEnd)) {
    throw new Error('scheduled_start must be before scheduled_end');
  }

  const { rows } = await pool.query(`
    UPDATE tasks t SET
      title=CASE WHEN $3::boolean THEN $4 ELSE t.title END,
      description=CASE WHEN $5::boolean THEN $6 ELSE t.description END,
      status=CASE WHEN $7::boolean THEN $8 ELSE t.status END,
      priority=CASE WHEN $9::boolean THEN $10 ELSE t.priority END,
      project_id=CASE WHEN $11::boolean THEN NULLIF($12,'')::uuid ELSE t.project_id END,
      due_at=CASE WHEN $13::boolean THEN NULLIF($14,'')::timestamptz ELSE t.due_at END,
      scheduled_start=CASE WHEN $15::boolean THEN NULLIF($16,'')::timestamptz ELSE t.scheduled_start END,
      scheduled_end=CASE WHEN $17::boolean THEN NULLIF($18,'')::timestamptz ELSE t.scheduled_end END,
      blocker=CASE WHEN $19::boolean THEN NULLIF($20,'') ELSE t.blocker END,
      updated_at=now()
    WHERE t.id=$2::uuid AND t.user_id=$1 AND t.deleted_at IS NULL
      AND ($11::boolean = false OR EXISTS (
        SELECT 1 FROM projects p WHERE p.id=NULLIF($12,'')::uuid AND p.user_id=$1 AND p.deleted_at IS NULL
      ))
      AND NOT ($15::boolean AND $17::boolean AND NULLIF($16,'')::timestamptz > NULLIF($18,'')::timestamptz)
    RETURNING t.id::text, t.project_id::text, t.title, t.description, t.status, t.priority,
              t.due_at, t.scheduled_start, t.scheduled_end, t.blocker, t.source, t.updated_at
  `, [
    userId(), task_id,
    title !== undefined, title === undefined ? null : String(title).trim(),
    description !== undefined, description ?? null,
    status !== undefined, status ?? null,
    priority !== undefined, priority === undefined ? null : Number(priority),
    project_id !== undefined, project_id ?? '',
    due_at !== undefined, due || '',
    scheduled_start !== undefined, start || '',
    scheduled_end !== undefined, end || '',
    blocker !== undefined, blocker ?? ''
  ]);
  if (!rows.length) throw new Error('task not found or project reassignment is not allowed');
  await recordMutationEvent({
    operation: 'atlas_update_task',
    idempotencyKey: idempotency_key,
    correlationId: correlation_id,
    intentHash,
    contentText: `Updated task: ${rows[0].title}. Status ${rows[0].status}.`,
    contentJson: rows[0],
    projectHint: rows[0].project_id
  });
  return rows[0];
}

export async function atlasUpdateProject({ project_id, status, lifecycle, priority, next_action, blockers, objective, idempotency_key, correlation_id } = {}) {
  if (!project_id) throw new Error('project_id is required');
  if (lifecycle !== undefined && lifecycle !== null && !atlasLifecycle().includes(lifecycle)) throw new Error(`invalid project lifecycle: ${lifecycle}`);
  const intentHash = hashIntent('atlas_update_project', {
    project_id, status, lifecycle,
    priority: priority == null ? priority : Number(priority),
    next_action, blockers, objective
  });
  const existing = await loadIdempotentMutation('atlas_update_project', idempotency_key, intentHash);
  if (existing) return existing;
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
  await recordMutationEvent({
    operation: 'atlas_update_project',
    idempotencyKey: idempotency_key,
    correlationId: correlation_id,
    intentHash,
    contentText: `Project update: ${rows[0].name}. Status ${rows[0].status}. Lifecycle ${rows[0].lifecycle || 'unmapped'}. Next action: ${rows[0].next_action || 'none'}`,
    contentJson: rows[0],
    projectHint: rows[0].name
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
