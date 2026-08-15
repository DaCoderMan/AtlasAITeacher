import crypto from 'node:crypto';
import pg from 'pg';
import { routeAgent } from './router.js';
import { runCriticQA } from './critic.js';
import { checkSystemHealth } from './system-health.js';
import { atlasProjects, atlasTasks } from './atlas-store.js';
import { buildTodayPlan } from './today-engine.js';
import { listExecutionRuns, listExecutionRunEvents } from './execution-runs.js';
import { getReleaseGateStatus } from './release-gate.js';
import { recordMutationJournal } from './mutation-journal.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userId = () => process.env.ATLAS_USER_ID || 'default';
const GLOBAL_PLAN_SCOPE = '__global__';
let sessionStorageReady;
let healthStorageReady;

function inputHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function scheduledCommitments(tasks, now = new Date()) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return tasks
    .filter(task => task.scheduled_start && task.scheduled_end)
    .filter(task => {
      const start = new Date(task.scheduled_start);
      return Number.isFinite(start.getTime()) && start >= dayStart && start < dayEnd;
    })
    .map(task => ({ id: task.id, title: task.title, start: task.scheduled_start, end: task.scheduled_end, source: task.source || 'neon_task' }));
}

export async function routeAndRecord(input = {}) {
  const route = routeAgent(input);
  const projectKey = input.resolved_context?.project?.id || null;
  const { rows } = await pool.query(`
    INSERT INTO atlas_agent_routes
      (user_id, project_key, intent, workflow_type, selected_agents, required_capabilities, risk, qa_required, warnings, rationale)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb)
    RETURNING id::text, created_at
  `, [
    userId(), projectKey, String(input.intent || input.mode || ''), route.workflow_type,
    JSON.stringify(route.selected_agents), JSON.stringify(route.required_capabilities), route.risk,
    route.qa_required, JSON.stringify(route.warnings), JSON.stringify(route.rationale)
  ]);
  const result = { ...route, route_id: rows[0].id, recorded_at: rows[0].created_at };
  await recordMutationJournal({
    operation: 'atlas_route_record',
    contentText: `Recorded routing decision for ${String(input.intent || input.mode || 'unknown intent')}`,
    contentJson: result,
    projectHint: projectKey,
    rollbackNote: 'Delete the route record if downstream verification determines it should not persist.'
  });
  return result;
}

export async function criticAndRecord(input = {}) {
  const qa = runCriticQA(input);
  const projectKey = input.claimed_project_id || input.resolved_context?.project?.id || null;
  const { rows } = await pool.query(`
    INSERT INTO atlas_qa_runs(user_id, project_key, status, summary, findings, input_hash)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
    RETURNING id::text, created_at
  `, [userId(), projectKey, qa.status, JSON.stringify(qa.summary), JSON.stringify(qa.findings), inputHash(input)]);
  const result = { ...qa, qa_run_id: rows[0].id, recorded_at: rows[0].created_at };
  await recordMutationJournal({
    operation: 'atlas_critic_qa_record',
    contentText: `Recorded QA result with status ${qa.status}`,
    contentJson: result,
    projectHint: projectKey,
    rollbackNote: 'Delete the QA run if it was recorded against the wrong scope or input.'
  });
  return result;
}

export async function healthAndRecord(input = {}) {
  await ensureHealthStorage();
  const health = await checkSystemHealth(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const service of health.services) {
      await client.query(`
        INSERT INTO atlas_health_checks
          (user_id, service_id, category, execution_plane, health, configured, latency_ms, failure_summary, capabilities, checked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
      `, [userId(), service.service_id, service.category, service.execution_plane || 'connector', service.health,
          service.configured, service.latency_ms, service.failure_summary, JSON.stringify(service.capabilities || []), service.last_checked]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await recordMutationJournal({
    operation: 'atlas_system_health_record',
    contentText: `Recorded ${health.services.length} health observations with overall ${health.overall}`,
    contentJson: health,
    rollbackNote: 'Delete the health observations if they were recorded from an invalid probe run.'
  });
  return health;
}

async function ensureHealthStorage() {
  if (!healthStorageReady) {
    healthStorageReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          ALTER TABLE atlas_health_checks
          ADD COLUMN IF NOT EXISTS execution_plane text
        `);
      } finally {
        client.release();
      }
    })().catch(error => {
      healthStorageReady = null;
      throw error;
    });
  }
  return healthStorageReady;
}

export async function todayAndRecord(input = {}) {
  const [projects, tasks] = await Promise.all([atlasProjects({ limit: 100 }), atlasTasks({ limit: 100 })]);
  const now = new Date(input.now || Date.now());
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const commitments = scheduledCommitments(tasks, safeNow);
  const plan = buildTodayPlan({
    tasks,
    projects,
    commitments,
    now: safeNow.toISOString(),
    active_project_id: input.active_project_id || null,
    max_major_wip: input.max_major_wip || 3
  });
  const planDate = safeNow.toISOString().slice(0, 10);
  const activeProjectId = input.active_project_id || GLOBAL_PLAN_SCOPE;
  const { rows } = await pool.query(`
    INSERT INTO atlas_daily_plans(user_id, plan_date, active_project_id, plan)
    VALUES ($1,$2::date,$3,$4::jsonb)
    ON CONFLICT (user_id, plan_date, active_project_id)
    DO UPDATE SET plan=EXCLUDED.plan, updated_at=now()
    RETURNING id::text, created_at, updated_at
  `, [userId(), planDate, activeProjectId, JSON.stringify(plan)]);
  const result = {
    ...plan,
    daily_plan_id: rows[0].id,
    plan_scope: activeProjectId === GLOBAL_PLAN_SCOPE ? 'global' : activeProjectId,
    persisted_at: rows[0].updated_at || rows[0].created_at
  };
  await recordMutationJournal({
    operation: 'atlas_today_record',
    contentText: `Persisted daily Atlas plan for ${planDate}`,
    contentJson: result,
    projectHint: activeProjectId === GLOBAL_PLAN_SCOPE ? null : activeProjectId,
    rollbackNote: 'Overwrite the saved daily plan with the previous version if this snapshot is invalid.'
  });
  return result;
}

function sessionProjectKey(input = {}) {
  return input.project_key || input.resolved_context?.project?.id || null;
}

function sessionResumeHandle(sessionId) {
  return `resume:${sessionId}`;
}

async function ensureSessionStorage() {
  if (!sessionStorageReady) {
    sessionStorageReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS atlas_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id text NOT NULL,
            project_key text,
            status text NOT NULL DEFAULT 'active',
            current_version integer NOT NULL DEFAULT 0,
            latest_checkpoint_id uuid,
            resume_handle text UNIQUE,
            context jsonb NOT NULL DEFAULT '{}'::jsonb,
            conflict_state jsonb NOT NULL DEFAULT '{}'::jsonb,
            last_checkpoint_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS atlas_sessions_user_updated_idx
            ON atlas_sessions(user_id, updated_at DESC)
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS atlas_session_checkpoints (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id uuid NOT NULL REFERENCES atlas_sessions(id) ON DELETE CASCADE,
            user_id text NOT NULL,
            checkpoint_version integer NOT NULL,
            expected_canonical_version integer,
            delta jsonb NOT NULL DEFAULT '{}'::jsonb,
            checkpoint_state jsonb NOT NULL DEFAULT '{}'::jsonb,
            causal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
            unfinished_handle text,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(session_id, checkpoint_version)
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS atlas_session_checkpoints_session_created_idx
            ON atlas_session_checkpoints(session_id, created_at DESC)
        `);
        await client.query(`
          ALTER TABLE atlas_session_checkpoints
          ADD COLUMN IF NOT EXISTS causal_links jsonb NOT NULL DEFAULT '[]'::jsonb
        `);
      } finally {
        client.release();
      }
    })().catch(error => {
      sessionStorageReady = null;
      throw error;
    });
  }
  return sessionStorageReady;
}

export async function checkpointSession(input = {}) {
  await ensureSessionStorage();
  const projectKey = sessionProjectKey(input);
  const expectedCanonicalVersion = input.expected_canonical_version == null ? null : Number(input.expected_canonical_version);
  if (expectedCanonicalVersion != null && !Number.isInteger(expectedCanonicalVersion)) {
    throw new Error('expected_canonical_version must be an integer');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sessionId = input.session_id || null;
    let sessionRow;
    if (sessionId) {
      const found = await client.query(`
        SELECT id::text, current_version, status, resume_handle, project_key
        FROM atlas_sessions
        WHERE id=$1::uuid AND user_id=$2
        FOR UPDATE
      `, [sessionId, userId()]);
      if (!found.rowCount) throw new Error('session not found');
      sessionRow = found.rows[0];
      if (input.expected_session_version != null && Number(input.expected_session_version) !== Number(sessionRow.current_version)) {
        throw new Error('session_version_conflict');
      }
    } else {
      const created = await client.query(`
        INSERT INTO atlas_sessions(user_id, project_key, context, conflict_state)
        VALUES ($1,$2,$3::jsonb,'{}'::jsonb)
        RETURNING id::text, current_version, status, resume_handle, project_key
      `, [userId(), projectKey, JSON.stringify(input.context || {})]);
      sessionRow = created.rows[0];
      sessionId = sessionRow.id;
    }

    const nextVersion = Number(sessionRow.current_version) + 1;
    const checkpoint = await client.query(`
      INSERT INTO atlas_session_checkpoints
        (session_id, user_id, checkpoint_version, expected_canonical_version, delta, checkpoint_state, causal_links, unfinished_handle)
      VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
      RETURNING id::text, session_id::text, checkpoint_version, expected_canonical_version, causal_links, unfinished_handle, created_at
    `, [
      sessionId,
      userId(),
      nextVersion,
      expectedCanonicalVersion,
      JSON.stringify(input.delta || {}),
      JSON.stringify(input.checkpoint_state || {}),
      JSON.stringify(Array.isArray(input.causal_links) ? input.causal_links : []),
      input.unfinished_handle || `unfinished:${sessionId}:${nextVersion}`
    ]);

    const resumeHandle = sessionRow.resume_handle || sessionResumeHandle(sessionId);
    await client.query(`
      UPDATE atlas_sessions
      SET current_version=$3,
          latest_checkpoint_id=$4::uuid,
          resume_handle=$5,
          project_key=COALESCE($6, project_key),
          context=CASE WHEN $7::boolean THEN $8::jsonb ELSE context END,
          conflict_state=CASE WHEN $9::boolean THEN $10::jsonb ELSE conflict_state END,
          last_checkpoint_at=now(),
          updated_at=now()
      WHERE id=$1::uuid AND user_id=$2
    `, [
      sessionId,
      userId(),
      nextVersion,
      checkpoint.rows[0].id,
      resumeHandle,
      projectKey,
      input.context !== undefined,
      JSON.stringify(input.context || {}),
      input.conflict_state !== undefined,
      JSON.stringify(input.conflict_state || {})
    ]);

    await client.query('COMMIT');
    const result = {
      session_id: sessionId,
      checkpoint_id: checkpoint.rows[0].id,
      checkpoint_version: checkpoint.rows[0].checkpoint_version,
      expected_canonical_version: checkpoint.rows[0].expected_canonical_version,
      causal_links: checkpoint.rows[0].causal_links || [],
      resume_handle: resumeHandle,
      unfinished_handle: checkpoint.rows[0].unfinished_handle,
      status: 'checkpointed',
      project_key: projectKey,
      created_at: checkpoint.rows[0].created_at
    };
    await recordMutationJournal({
      operation: 'atlas_checkpoint_session',
      contentText: `Checkpointed session ${sessionId} at version ${nextVersion}`,
      contentJson: result,
      projectHint: projectKey,
      beforeState: input.session_id ? { session_id: sessionId, previous_version: sessionRow.current_version } : null,
      rollbackNote: 'Delete the incorrect checkpoint row or restore the session version if this checkpoint was persisted in error.'
    });
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resumeSession({ session_id, resume_handle } = {}) {
  await ensureSessionStorage();
  if (!session_id && !resume_handle) throw new Error('session_id or resume_handle is required');
  const { rows } = await pool.query(`
    SELECT s.id::text AS session_id, s.project_key, s.status, s.current_version, s.resume_handle,
           s.context, s.conflict_state, s.last_checkpoint_at, s.updated_at,
           c.id::text AS checkpoint_id, c.checkpoint_version, c.expected_canonical_version,
           c.delta, c.checkpoint_state, c.causal_links, c.unfinished_handle, c.created_at AS checkpoint_created_at
    FROM atlas_sessions s
    LEFT JOIN atlas_session_checkpoints c ON c.id=s.latest_checkpoint_id
    WHERE s.user_id=$1
      AND (($2::uuid IS NOT NULL AND s.id=$2::uuid) OR ($3::text IS NOT NULL AND s.resume_handle=$3))
    ORDER BY s.updated_at DESC
    LIMIT 1
  `, [userId(), session_id || null, resume_handle || null]);
  if (!rows.length) throw new Error('session not found');
  const row = rows[0];
  return {
    session_id: row.session_id,
    project_key: row.project_key,
    status: row.status,
    current_version: row.current_version,
    resume_handle: row.resume_handle,
    context: row.context || {},
    conflict_state: row.conflict_state || {},
    last_checkpoint_at: row.last_checkpoint_at,
    latest_checkpoint: row.checkpoint_id ? {
      checkpoint_id: row.checkpoint_id,
      checkpoint_version: row.checkpoint_version,
      expected_canonical_version: row.expected_canonical_version,
      delta: row.delta || {},
      checkpoint_state: row.checkpoint_state || {},
      causal_links: row.causal_links || [],
      unfinished_handle: row.unfinished_handle,
      created_at: row.checkpoint_created_at
    } : null
  };
}

export async function getControlPlaneActivity({ limit = 20 } = {}) {
  await ensureHealthStorage();
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const [routes, qa, health, plans, conflicts, executionRuns, executionRunEvents, mutations] = await Promise.all([
    pool.query(`
      SELECT id::text, project_key, intent, workflow_type, selected_agents, required_capabilities, risk, qa_required, warnings, created_at
      FROM atlas_agent_routes WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2
    `, [userId(), n]),
    pool.query(`
      SELECT id::text, project_key, status, summary, findings, created_at
      FROM atlas_qa_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2
    `, [userId(), n]),
    pool.query(`
      SELECT DISTINCT ON (service_id) service_id, category, execution_plane, health, configured, latency_ms, failure_summary, capabilities, checked_at
      FROM atlas_health_checks WHERE user_id=$1 ORDER BY service_id, checked_at DESC
    `, [userId()]),
    pool.query(`
      SELECT id::text, plan_date,
             CASE WHEN active_project_id=$3 THEN NULL ELSE active_project_id END AS active_project_id,
             plan, updated_at
      FROM atlas_daily_plans WHERE user_id=$1 ORDER BY plan_date DESC, updated_at DESC LIMIT $2
    `, [userId(), Math.min(n, 14), GLOBAL_PLAN_SCOPE]),
    pool.query(`
      SELECT id::text, entity_type, entity_key, sources, competing_values, proposed_value, authority_reason, status, first_seen_at, last_seen_at, resolved_at
      FROM atlas_conflicts WHERE user_id=$1 AND status='open' ORDER BY last_seen_at DESC LIMIT $2
    `, [userId(), n]),
    listExecutionRuns({ active_only: true, limit: Math.min(n, 10) }),
    listExecutionRunEvents({ limit: n }),
    pool.query(`
      SELECT id::text, source_event_id, content_json, provenance, project_hint, created_at
      FROM atlas_events
      WHERE user_id=$1 AND source IN ('atlas_mcp_mutation', 'atlas_system_mutation')
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId(), n])
  ]);
  return {
    routes: routes.rows,
    qa_runs: qa.rows,
    latest_health: health.rows,
    daily_plans: plans.rows,
    open_conflicts: conflicts.rows,
    active_execution_runs: executionRuns,
    execution_run_events: executionRunEvents,
    release_gate: getReleaseGateStatus(),
    recent_mutations: mutations.rows.map(row => ({
      id: row.id,
      source_event_id: row.source_event_id,
      operation: row.provenance?.mutation_operation || null,
      verification_status: row.provenance?.verification_status || null,
      changed_fields: Array.isArray(row.provenance?.changed_fields) ? row.provenance.changed_fields : [],
      rollback_note: row.provenance?.rollback_note || null,
      before_state: row.provenance?.before_state || null,
      after_state: row.provenance?.after_state || row.content_json || null,
      project_hint: row.project_hint || null,
      created_at: row.created_at
    }))
  };
}

export async function closeControlPlanePool() {
  await pool.end();
}
