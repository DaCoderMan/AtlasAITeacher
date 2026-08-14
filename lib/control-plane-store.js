import crypto from 'node:crypto';
import pg from 'pg';
import { routeAgent } from './router.js';
import { runCriticQA } from './critic.js';
import { checkSystemHealth } from './system-health.js';
import { atlasProjects, atlasTasks } from './atlas-store.js';
import { buildTodayPlan } from './today-engine.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userId = () => process.env.ATLAS_USER_ID || 'default';
const GLOBAL_PLAN_SCOPE = '__global__';

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
  return { ...route, route_id: rows[0].id, recorded_at: rows[0].created_at };
}

export async function criticAndRecord(input = {}) {
  const qa = runCriticQA(input);
  const projectKey = input.claimed_project_id || input.resolved_context?.project?.id || null;
  const { rows } = await pool.query(`
    INSERT INTO atlas_qa_runs(user_id, project_key, status, summary, findings, input_hash)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
    RETURNING id::text, created_at
  `, [userId(), projectKey, qa.status, JSON.stringify(qa.summary), JSON.stringify(qa.findings), inputHash(input)]);
  return { ...qa, qa_run_id: rows[0].id, recorded_at: rows[0].created_at };
}

export async function healthAndRecord(input = {}) {
  const health = await checkSystemHealth(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const service of health.services) {
      await client.query(`
        INSERT INTO atlas_health_checks
          (user_id, service_id, category, health, configured, latency_ms, failure_summary, capabilities, checked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz)
      `, [userId(), service.service_id, service.category, service.health, service.configured,
          service.latency_ms, service.failure_summary, JSON.stringify(service.capabilities || []), service.last_checked]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return health;
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
  return {
    ...plan,
    daily_plan_id: rows[0].id,
    plan_scope: activeProjectId === GLOBAL_PLAN_SCOPE ? 'global' : activeProjectId,
    persisted_at: rows[0].updated_at || rows[0].created_at
  };
}

export async function getControlPlaneActivity({ limit = 20 } = {}) {
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const [routes, qa, health, plans, conflicts] = await Promise.all([
    pool.query(`
      SELECT id::text, project_key, intent, workflow_type, selected_agents, required_capabilities, risk, qa_required, warnings, created_at
      FROM atlas_agent_routes WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2
    `, [userId(), n]),
    pool.query(`
      SELECT id::text, project_key, status, summary, findings, created_at
      FROM atlas_qa_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2
    `, [userId(), n]),
    pool.query(`
      SELECT DISTINCT ON (service_id) service_id, category, health, configured, latency_ms, failure_summary, capabilities, checked_at
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
    `, [userId(), n])
  ]);
  return { routes: routes.rows, qa_runs: qa.rows, latest_health: health.rows, daily_plans: plans.rows, open_conflicts: conflicts.rows };
}

export async function closeControlPlanePool() {
  await pool.end();
}
