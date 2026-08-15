import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userId = () => process.env.ATLAS_USER_ID || 'default';

let executionRunStorageReady;

const STEP_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'skipped']);

function jsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function parseJsonObject(value, fallback) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function parseJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStep(step = {}, index = 0) {
  const stepKey = String(step.step_key || step.key || `step-${index + 1}`).trim();
  const title = String(step.title || '').trim();
  if (!stepKey) throw new Error(`step ${index + 1} is missing step_key`);
  if (!title) throw new Error(`step ${stepKey} is missing title`);
  return {
    step_index: index + 1,
    step_key: stepKey,
    title,
    canonical_task_key: step.canonical_task_key ? String(step.canonical_task_key).trim() : null,
    depends_on_step_keys: parseJsonArray(step.depends_on_step_keys || step.depends_on || []).map(item => String(item).trim()).filter(Boolean),
    instructions_json: parseJsonObject(step.instructions_json || step.instructions || {}, {}),
    evidence_requirements_json: parseJsonObject(step.evidence_requirements_json || step.evidence_requirements || {}, {}),
    allowed_actions_json: parseJsonArray(step.allowed_actions_json || step.allowed_actions || []),
    test_requirements_json: parseJsonArray(step.test_requirements_json || step.required_tests || []),
    live_verification_json: parseJsonArray(step.live_verification_json || step.required_live_verification || []),
    rollback_note: step.rollback_note == null ? null : String(step.rollback_note)
  };
}

export function normalizeExecutionRunbook(input = {}) {
  const runKey = String(input.run_key || '').trim();
  if (!runKey) throw new Error('run_key is required');
  const steps = parseJsonArray(input.steps);
  if (!steps.length) throw new Error('runbook steps are required');
  const normalizedSteps = steps.map(normalizeStep);
  const stepKeys = new Set();
  for (const step of normalizedSteps) {
    if (stepKeys.has(step.step_key)) throw new Error(`duplicate step_key: ${step.step_key}`);
    stepKeys.add(step.step_key);
  }
  for (const step of normalizedSteps) {
    for (const dep of step.depends_on_step_keys) {
      if (!stepKeys.has(dep)) throw new Error(`step ${step.step_key} depends on unknown step ${dep}`);
      if (dep === step.step_key) throw new Error(`step ${step.step_key} cannot depend on itself`);
    }
  }
  return {
    run_key: runKey,
    project_key: input.project_key ? String(input.project_key).trim() : null,
    task_family: input.task_family ? String(input.task_family).trim() : null,
    program_key: input.program_key ? String(input.program_key).trim() : null,
    run_revision: Math.max(1, Number(input.run_revision) || 1),
    created_by: String(input.created_by || 'codex'),
    session_id: input.session_id || null,
    session_resume_handle: input.session_resume_handle || null,
    metadata: parseJsonObject(input.metadata || {}, {}),
    steps: normalizedSteps
  };
}

function summarizeTaskProgress(steps, currentStep) {
  if (!currentStep?.canonical_task_key) return null;
  const sameTask = steps.filter(step => step.canonical_task_key === currentStep.canonical_task_key);
  if (!sameTask.length) return null;
  const position = sameTask.findIndex(step => step.step_key === currentStep.step_key) + 1;
  const completed = sameTask.filter(step => step.status === 'completed').length;
  return {
    canonical_task_key: currentStep.canonical_task_key,
    completed_steps: completed,
    total_steps: sameTask.length,
    current_position: position
  };
}

export function buildExecutionProgress(run = {}, steps = []) {
  const totalSteps = Number(run.total_steps ?? steps.length ?? 0);
  const completedSteps = Number(run.completed_steps ?? steps.filter(step => step.status === 'completed').length ?? 0);
  const blockedSteps = Number(run.blocked_steps ?? steps.filter(step => step.status === 'blocked').length ?? 0);
  const currentStep = steps.find(step => step.status === 'in_progress')
    || steps.find(step => step.status === 'blocked')
    || steps.find(step => step.step_index === run.current_step_index)
    || steps.find(step => step.status === 'pending')
    || null;
  const taskProgress = summarizeTaskProgress(steps, currentStep);

  let progressMessage;
  if (!totalSteps) progressMessage = '0/0 steps';
  else if (run.status === 'completed') progressMessage = `${completedSteps}/${totalSteps} steps complete`;
  else if (taskProgress) {
    progressMessage = `${taskProgress.canonical_task_key}, step ${taskProgress.current_position}/${taskProgress.total_steps}; overall ${completedSteps}/${totalSteps} steps`;
  } else if (currentStep) {
    progressMessage = `step ${currentStep.step_index}/${totalSteps}; overall ${completedSteps}/${totalSteps} steps`;
  } else {
    progressMessage = `${completedSteps}/${totalSteps} steps`;
  }

  return {
    run_id: run.id || null,
    run_key: run.run_key || null,
    run_revision: run.run_revision || 1,
    status: run.status || (blockedSteps ? 'blocked' : completedSteps === totalSteps && totalSteps ? 'completed' : 'pending'),
    total_steps: totalSteps,
    completed_steps: completedSteps,
    blocked_steps: blockedSteps,
    current_step: currentStep ? {
      step_id: currentStep.id || null,
      step_index: currentStep.step_index,
      step_key: currentStep.step_key,
      title: currentStep.title,
      status: currentStep.status,
      canonical_task_key: currentStep.canonical_task_key || null
    } : null,
    task_progress: taskProgress,
    progress_message: progressMessage
  };
}

export function latestRunRevisions(runs = []) {
  const latestByKey = new Map();
  for (const run of runs) {
    const key = String(run.run_key || '');
    const current = latestByKey.get(key);
    if (!current) {
      latestByKey.set(key, run);
      continue;
    }
    const candidateRevision = Number(run.run_revision || 0);
    const currentRevision = Number(current.run_revision || 0);
    if (candidateRevision > currentRevision) {
      latestByKey.set(key, run);
      continue;
    }
    if (candidateRevision === currentRevision && String(run.updated_at || '') > String(current.updated_at || '')) {
      latestByKey.set(key, run);
    }
  }
  return runs.filter(run => latestByKey.get(String(run.run_key || '')) === run);
}

export function latestActiveRunRevisions(runs = []) {
  return latestRunRevisions(runs)
    .filter(run => ['pending', 'in_progress', 'blocked'].includes(String(run.status || '')))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function runResumeHandle(runKey, runRevision) {
  return `run:${runKey}:r${runRevision}`;
}

async function ensureExecutionRunStorage() {
  if (!executionRunStorageReady) {
    executionRunStorageReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS atlas_execution_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id text NOT NULL,
            run_key text NOT NULL,
            run_revision integer NOT NULL DEFAULT 1,
            project_key text,
            task_family text,
            program_key text,
            status text NOT NULL DEFAULT 'pending',
            run_version integer NOT NULL DEFAULT 1,
            total_steps integer NOT NULL DEFAULT 0,
            completed_steps integer NOT NULL DEFAULT 0,
            blocked_steps integer NOT NULL DEFAULT 0,
            current_step_index integer,
            current_step_id uuid,
            current_step_key text,
            created_by text NOT NULL DEFAULT 'codex',
            session_id uuid,
            session_resume_handle text,
            resume_handle text UNIQUE,
            last_checkpoint_id uuid,
            runbook jsonb NOT NULL DEFAULT '{}'::jsonb,
            runbook_hash text,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            last_progress_message text,
            last_progress_at timestamptz,
            started_at timestamptz,
            completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(user_id, run_key, run_revision)
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS atlas_execution_runs_user_updated_idx
            ON atlas_execution_runs(user_id, updated_at DESC)
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS atlas_execution_run_steps (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL REFERENCES atlas_execution_runs(id) ON DELETE CASCADE,
            user_id text NOT NULL,
            step_index integer NOT NULL,
            step_key text NOT NULL,
            title text NOT NULL,
            status text NOT NULL DEFAULT 'pending',
            canonical_task_key text,
            depends_on_step_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
            instructions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            evidence_requirements_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            allowed_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            test_requirements_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            live_verification_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            rollback_note text,
            evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            evidence_records_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            waiver_metadata_json jsonb,
            result_summary text,
            blocked_reason text,
            started_at timestamptz,
            completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(run_id, step_index),
            UNIQUE(run_id, step_key)
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS atlas_execution_run_steps_run_idx
            ON atlas_execution_run_steps(run_id, step_index)
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS atlas_execution_run_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL REFERENCES atlas_execution_runs(id) ON DELETE CASCADE,
            step_id uuid REFERENCES atlas_execution_run_steps(id) ON DELETE SET NULL,
            user_id text NOT NULL,
            event_type text NOT NULL,
            details jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS atlas_execution_run_events_run_created_idx
            ON atlas_execution_run_events(run_id, created_at DESC)
        `);
      } finally {
        client.release();
      }
    })().catch(error => {
      executionRunStorageReady = null;
      throw error;
    });
  }
  return executionRunStorageReady;
}

function dependencyReady(step, steps) {
  return step.depends_on_step_keys.every(dep => {
    const depStep = steps.find(item => item.step_key === dep);
    return depStep && depStep.status === 'completed';
  });
}

async function loadRunRecord(client, { run_id, run_key, run_revision, resume_handle }, { forUpdate = false } = {}) {
  const clauses = [];
  const params = [userId()];
  if (run_id) {
    params.push(run_id);
    clauses.push(`id=$${params.length}::uuid`);
  }
  if (run_key) {
    params.push(run_key);
    clauses.push(`run_key=$${params.length}`);
  }
  if (resume_handle) {
    params.push(resume_handle);
    clauses.push(`resume_handle=$${params.length}`);
  }
  if (!clauses.length) throw new Error('run_id, run_key, or resume_handle is required');
  let revisionClause = '';
  if (run_revision != null) {
    params.push(Math.max(1, Number(run_revision) || 1));
    revisionClause = ` AND run_revision=$${params.length}`;
  }
  const orderClause = run_revision == null ? 'ORDER BY run_revision DESC' : '';
  const limitClause = 'LIMIT 1';
  const { rows } = await client.query(`
    SELECT id::text, run_key, run_revision, project_key, task_family, program_key, status, run_version,
           total_steps, completed_steps, blocked_steps, current_step_index, current_step_id::text,
           current_step_key, created_by, session_id::text, session_resume_handle, resume_handle,
           last_checkpoint_id::text, runbook, runbook_hash, metadata, last_progress_message,
           last_progress_at, started_at, completed_at, created_at, updated_at
    FROM atlas_execution_runs
    WHERE user_id=$1 AND (${clauses.join(' OR ')})${revisionClause}
    ${orderClause}
    ${limitClause}
    ${forUpdate ? 'FOR UPDATE' : ''}
  `, params);
  if (!rows.length) throw new Error('execution run not found');
  return rows[0];
}

async function loadRunSteps(client, runId, { forUpdate = false } = {}) {
  const { rows } = await client.query(`
    SELECT id::text, run_id::text, step_index, step_key, title, status, canonical_task_key,
           depends_on_step_keys, instructions_json, evidence_requirements_json, allowed_actions_json,
           test_requirements_json, live_verification_json, rollback_note, evidence_ids_json,
           evidence_records_json, waiver_metadata_json, result_summary, blocked_reason,
           started_at, completed_at, created_at, updated_at
    FROM atlas_execution_run_steps
    WHERE run_id=$1::uuid AND user_id=$2
    ORDER BY step_index ASC
    ${forUpdate ? 'FOR UPDATE' : ''}
  `, [runId, userId()]);
  return rows.map(row => ({
    ...row,
    depends_on_step_keys: parseJsonArray(row.depends_on_step_keys),
    instructions_json: parseJsonObject(row.instructions_json, {}),
    evidence_requirements_json: parseJsonObject(row.evidence_requirements_json, {}),
    allowed_actions_json: parseJsonArray(row.allowed_actions_json),
    test_requirements_json: parseJsonArray(row.test_requirements_json),
    live_verification_json: parseJsonArray(row.live_verification_json),
    evidence_ids_json: parseJsonArray(row.evidence_ids_json),
    evidence_records_json: parseJsonArray(row.evidence_records_json),
    waiver_metadata_json: row.waiver_metadata_json && typeof row.waiver_metadata_json === 'object' ? row.waiver_metadata_json : null
  }));
}

async function logRunEvent(client, { runId, stepId = null, eventType, details = {} }) {
  await client.query(`
    INSERT INTO atlas_execution_run_events(run_id, step_id, user_id, event_type, details)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
  `, [runId, stepId, userId(), eventType, JSON.stringify(details)]);
}

async function refreshRunState(client, runId) {
  const steps = await loadRunSteps(client, runId, { forUpdate: true });
  const completedSteps = steps.filter(step => step.status === 'completed').length;
  const blockedSteps = steps.filter(step => step.status === 'blocked').length;
  const totalSteps = steps.length;
  const currentStep = steps.find(step => step.status === 'in_progress')
    || steps.find(step => step.status === 'blocked')
    || steps.find(step => step.status === 'pending')
    || null;
  let status = 'pending';
  if (totalSteps && completedSteps === totalSteps) status = 'completed';
  else if (blockedSteps) status = 'blocked';
  else if (steps.some(step => ['in_progress', 'completed'].includes(step.status))) status = 'in_progress';
  const progress = buildExecutionProgress({
    id: runId,
    status,
    total_steps: totalSteps,
    completed_steps: completedSteps,
    blocked_steps: blockedSteps,
    current_step_index: currentStep?.step_index || null,
    run_key: null,
    run_revision: 1
  }, steps);
  const { rows } = await client.query(`
    UPDATE atlas_execution_runs
    SET status=$2,
        total_steps=$3,
        completed_steps=$4,
        blocked_steps=$5,
        current_step_index=$6,
        current_step_id=$7::uuid,
        current_step_key=$8,
        run_version=run_version+1,
        last_progress_message=$9,
        last_progress_at=now(),
        started_at=CASE
          WHEN started_at IS NOT NULL THEN started_at
          WHEN $2 IN ('in_progress','blocked','completed') THEN now()
          ELSE started_at
        END,
        completed_at=CASE
          WHEN $2='completed' THEN COALESCE(completed_at, now())
          WHEN $2 <> 'completed' THEN NULL
          ELSE completed_at
        END,
        updated_at=now()
    WHERE id=$1::uuid AND user_id=$10
    RETURNING id::text, run_key, run_revision, project_key, task_family, program_key, status, run_version,
              total_steps, completed_steps, blocked_steps, current_step_index, current_step_id::text,
              current_step_key, created_by, session_id::text, session_resume_handle, resume_handle,
              last_checkpoint_id::text, runbook, runbook_hash, metadata, last_progress_message,
              last_progress_at, started_at, completed_at, created_at, updated_at
  `, [
    runId,
    status,
    totalSteps,
    completedSteps,
    blockedSteps,
    currentStep?.step_index || null,
    currentStep?.id || null,
    currentStep?.step_key || null,
    progress.progress_message,
    userId()
  ]);
  return { run: rows[0], steps };
}

function requiredEvidenceIds(step) {
  const requirements = parseJsonObject(step.evidence_requirements_json, {});
  const ids = parseJsonArray(requirements.required_ids || requirements.required_evidence_ids || []);
  return ids.map(item => String(item).trim()).filter(Boolean);
}

export function executionStepEvidenceState(step = {}) {
  const required_evidence_ids = requiredEvidenceIds(step);
  const recorded_evidence_ids = parseJsonArray(step.evidence_ids_json).map(item => String(item).trim()).filter(Boolean);
  const recorded = new Set(recorded_evidence_ids);
  const missing_evidence_ids = required_evidence_ids.filter(id => !recorded.has(id));
  return {
    required_evidence_ids,
    recorded_evidence_ids,
    missing_evidence_ids,
    completion_ready: missing_evidence_ids.length === 0
  };
}

function shapeRunResponse(run, steps, events = []) {
  const progress = buildExecutionProgress(run, steps);
  return {
    ...run,
    progress,
    steps: steps.map(step => ({
      id: step.id,
      step_index: step.step_index,
      step_key: step.step_key,
      title: step.title,
      status: step.status,
      canonical_task_key: step.canonical_task_key,
      depends_on_step_keys: step.depends_on_step_keys,
      instructions_json: step.instructions_json,
      evidence_requirements_json: step.evidence_requirements_json,
      allowed_actions_json: step.allowed_actions_json,
      test_requirements_json: step.test_requirements_json,
      live_verification_json: step.live_verification_json,
      rollback_note: step.rollback_note,
      evidence_ids_json: step.evidence_ids_json,
      evidence_records_json: step.evidence_records_json,
      evidence_state: executionStepEvidenceState(step),
      waiver_metadata_json: step.waiver_metadata_json,
      result_summary: step.result_summary,
      blocked_reason: step.blocked_reason,
      started_at: step.started_at,
      completed_at: step.completed_at
    })),
    recent_events: events
  };
}

function assertRunVersion(run, expectedRunVersion) {
  if (expectedRunVersion == null) return;
  const expected = Number(expectedRunVersion);
  if (!Number.isInteger(expected)) throw new Error('expected_run_version must be an integer');
  if (expected !== Number(run.run_version)) throw new Error('execution_run_version_conflict');
}

async function getRunStepForUpdate(client, locator = {}) {
  const run = await loadRunRecord(client, locator, { forUpdate: true });
  assertRunVersion(run, locator.expected_run_version);
  const steps = await loadRunSteps(client, run.id, { forUpdate: true });
  const step = locator.step_id
    ? steps.find(item => item.id === locator.step_id)
    : steps.find(item => item.step_key === locator.step_key);
  if (!step) throw new Error('execution run step not found');
  return { run, steps, step };
}

export async function startExecutionRun(input = {}) {
  await ensureExecutionRunStorage();
  const normalized = normalizeExecutionRunbook(input.runbook || input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`
      SELECT id::text
      FROM atlas_execution_runs
      WHERE user_id=$1 AND run_key=$2 AND run_revision=$3
      LIMIT 1
    `, [userId(), normalized.run_key, normalized.run_revision]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      return getExecutionRun({ run_id: existing.rows[0].id });
    }

    const runbookPayload = {
      run_key: normalized.run_key,
      project_key: normalized.project_key,
      task_family: normalized.task_family,
      program_key: normalized.program_key,
      run_revision: normalized.run_revision,
      metadata: normalized.metadata,
      steps: normalized.steps.map(step => ({
        step_key: step.step_key,
        title: step.title,
        canonical_task_key: step.canonical_task_key,
        depends_on_step_keys: step.depends_on_step_keys,
        instructions_json: step.instructions_json,
        evidence_requirements_json: step.evidence_requirements_json,
        allowed_actions_json: step.allowed_actions_json,
        test_requirements_json: step.test_requirements_json,
        live_verification_json: step.live_verification_json,
        rollback_note: step.rollback_note
      }))
    };
    const { rows } = await client.query(`
      INSERT INTO atlas_execution_runs(
        user_id, run_key, run_revision, project_key, task_family, program_key,
        status, run_version, total_steps, created_by, session_id, session_resume_handle,
        resume_handle, runbook, runbook_hash, metadata, last_progress_message
      )
      VALUES ($1,$2,$3,$4,$5,$6,'pending',1,$7,$8,NULLIF($9,'')::uuid,$10,$11,$12::jsonb,$13,$14::jsonb,$15)
      RETURNING id::text
    `, [
      userId(),
      normalized.run_key,
      normalized.run_revision,
      normalized.project_key,
      normalized.task_family,
      normalized.program_key,
      normalized.steps.length,
      normalized.created_by,
      normalized.session_id || '',
      normalized.session_resume_handle,
      runResumeHandle(normalized.run_key, normalized.run_revision),
      JSON.stringify(runbookPayload),
      jsonHash(runbookPayload),
      JSON.stringify(normalized.metadata),
      `0/${normalized.steps.length} steps`
    ]);
    const runId = rows[0].id;
    for (const step of normalized.steps) {
      await client.query(`
        INSERT INTO atlas_execution_run_steps(
          run_id, user_id, step_index, step_key, title, canonical_task_key,
          depends_on_step_keys, instructions_json, evidence_requirements_json, allowed_actions_json,
          test_requirements_json, live_verification_json, rollback_note
        )
        VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13)
      `, [
        runId,
        userId(),
        step.step_index,
        step.step_key,
        step.title,
        step.canonical_task_key,
        JSON.stringify(step.depends_on_step_keys),
        JSON.stringify(step.instructions_json),
        JSON.stringify(step.evidence_requirements_json),
        JSON.stringify(step.allowed_actions_json),
        JSON.stringify(step.test_requirements_json),
        JSON.stringify(step.live_verification_json),
        step.rollback_note
      ]);
    }
    await logRunEvent(client, {
      runId,
      eventType: 'run_started',
      details: { run_key: normalized.run_key, run_revision: normalized.run_revision, total_steps: normalized.steps.length }
    });
    const refreshed = await refreshRunState(client, runId);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getExecutionRun(locator = {}) {
  await ensureExecutionRunStorage();
  const client = await pool.connect();
  try {
    const run = await loadRunRecord(client, locator);
    const [steps, events] = await Promise.all([
      loadRunSteps(client, run.id),
      listExecutionRunEvents({ run_id: run.id, limit: 10 })
    ]);
    return shapeRunResponse(run, steps, events);
  } finally {
    client.release();
  }
}

export async function listExecutionRuns({ status, active_only = false, limit = 20 } = {}) {
  await ensureExecutionRunStorage();
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const params = [userId()];
  let filter = '';
  if (!active_only && status) {
    params.push(String(status));
    filter += ` AND status=$${params.length}`;
  }
  params.push(active_only ? Math.min(500, Math.max(n * 10, 50)) : n);
  const { rows } = await pool.query(`
    SELECT id::text, run_key, run_revision, project_key, task_family, program_key, status, run_version,
           total_steps, completed_steps, blocked_steps, current_step_index, current_step_id::text,
           current_step_key, created_by, session_id::text, session_resume_handle, resume_handle,
           last_checkpoint_id::text, metadata, last_progress_message, last_progress_at,
           started_at, completed_at, created_at, updated_at
    FROM atlas_execution_runs
    WHERE user_id=$1${filter}
    ORDER BY updated_at DESC
    LIMIT $${params.length}
  `, params);
  const shaped = rows.map(run => ({
    ...run,
    progress: buildExecutionProgress(run, [])
  }));
  return active_only ? latestActiveRunRevisions(shaped).slice(0, n) : shaped;
}

export async function claimNextExecutionStep(locator = {}) {
  await ensureExecutionRunStorage();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await loadRunRecord(client, locator, { forUpdate: true });
    assertRunVersion(run, locator.expected_run_version);
    const steps = await loadRunSteps(client, run.id, { forUpdate: true });
    let step = steps.find(item => item.status === 'in_progress');
    if (!step) {
      step = steps.find(item => item.status === 'pending' && dependencyReady(item, steps));
      if (!step) throw new Error('no_claimable_execution_step');
      await client.query(`
        UPDATE atlas_execution_run_steps
        SET status='in_progress', started_at=COALESCE(started_at, now()), blocked_reason=NULL, updated_at=now()
        WHERE id=$1::uuid
      `, [step.id]);
      await logRunEvent(client, {
        runId: run.id,
        stepId: step.id,
        eventType: 'step_claimed',
        details: { step_key: step.step_key, step_index: step.step_index }
      });
    }
    const refreshed = await refreshRunState(client, run.id);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateExecutionStep(input = {}) {
  await ensureExecutionRunStorage();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { run, step } = await getRunStepForUpdate(client, input);
    if (input.status && ['completed', 'blocked'].includes(String(input.status))) {
      throw new Error('use dedicated complete or block tool for terminal step states');
    }
    if (input.status && !STEP_STATUSES.has(String(input.status))) throw new Error('invalid execution step status');
    await client.query(`
      UPDATE atlas_execution_run_steps
      SET status=COALESCE($3, status),
          result_summary=CASE WHEN $4::boolean THEN $5 ELSE result_summary END,
          blocked_reason=CASE WHEN $6::boolean THEN $7 ELSE blocked_reason END,
          waiver_metadata_json=CASE WHEN $8::boolean THEN $9::jsonb ELSE waiver_metadata_json END,
          updated_at=now()
      WHERE id=$1::uuid AND run_id=$2::uuid
    `, [
      step.id,
      run.id,
      input.status || null,
      input.result_summary !== undefined,
      input.result_summary ?? null,
      input.blocked_reason !== undefined,
      input.blocked_reason ?? null,
      input.waiver_metadata !== undefined,
      JSON.stringify(input.waiver_metadata || {})
    ]);
    if (input.last_checkpoint_id) {
      await client.query(`
        UPDATE atlas_execution_runs
        SET last_checkpoint_id=$2::uuid, updated_at=now()
        WHERE id=$1::uuid
      `, [run.id, input.last_checkpoint_id]);
    }
    await logRunEvent(client, {
      runId: run.id,
      stepId: step.id,
      eventType: 'step_updated',
      details: { step_key: step.step_key, status: input.status || step.status }
    });
    const refreshed = await refreshRunState(client, run.id);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordExecutionEvidence(input = {}) {
  await ensureExecutionRunStorage();
  const evidence = parseJsonObject(input.evidence, null);
  if (!evidence?.evidence_id) throw new Error('evidence.evidence_id is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { run, step } = await getRunStepForUpdate(client, input);
    const records = step.evidence_records_json.filter(item => item.evidence_id !== evidence.evidence_id);
    records.push({
      evidence_id: String(evidence.evidence_id),
      type: evidence.type ? String(evidence.type) : null,
      value: evidence.value ?? null,
      uri: evidence.uri ?? null,
      summary: evidence.summary ?? null,
      recorded_at: new Date().toISOString()
    });
    const evidenceIds = [...new Set(records.map(item => item.evidence_id))];
    await client.query(`
      UPDATE atlas_execution_run_steps
      SET evidence_ids_json=$3::jsonb,
          evidence_records_json=$4::jsonb,
          updated_at=now()
      WHERE id=$1::uuid AND run_id=$2::uuid
    `, [step.id, run.id, JSON.stringify(evidenceIds), JSON.stringify(records)]);
    await logRunEvent(client, {
      runId: run.id,
      stepId: step.id,
      eventType: 'evidence_recorded',
      details: { step_key: step.step_key, evidence_id: evidence.evidence_id }
    });
    const refreshed = await refreshRunState(client, run.id);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function completeExecutionStep(input = {}) {
  await ensureExecutionRunStorage();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { run, steps, step } = await getRunStepForUpdate(client, input);
    if (!dependencyReady(step, steps)) throw new Error('execution step dependencies are not yet complete');
    const requiredIds = requiredEvidenceIds(step);
    const recordedIds = new Set(step.evidence_ids_json.map(item => String(item)));
    const missing = requiredIds.filter(id => !recordedIds.has(id));
    const waiverMetadata = input.waiver_metadata !== undefined ? parseJsonObject(input.waiver_metadata, {}) : step.waiver_metadata_json;
    if (missing.length && !waiverMetadata) {
      throw new Error(`missing required evidence ids: ${missing.join(', ')}`);
    }
    await client.query(`
      UPDATE atlas_execution_run_steps
      SET status='completed',
          result_summary=CASE WHEN $3::boolean THEN $4 ELSE result_summary END,
          waiver_metadata_json=CASE WHEN $5::boolean THEN $6::jsonb ELSE waiver_metadata_json END,
          blocked_reason=NULL,
          completed_at=now(),
          updated_at=now()
      WHERE id=$1::uuid AND run_id=$2::uuid
    `, [
      step.id,
      run.id,
      input.result_summary !== undefined,
      input.result_summary ?? null,
      input.waiver_metadata !== undefined,
      JSON.stringify(input.waiver_metadata || {})
    ]);
    if (input.last_checkpoint_id) {
      await client.query(`
        UPDATE atlas_execution_runs
        SET last_checkpoint_id=$2::uuid, updated_at=now()
        WHERE id=$1::uuid
      `, [run.id, input.last_checkpoint_id]);
    }
    await logRunEvent(client, {
      runId: run.id,
      stepId: step.id,
      eventType: 'step_completed',
      details: { step_key: step.step_key, evidence_ids: step.evidence_ids_json, waived: Boolean(waiverMetadata) }
    });
    const refreshed = await refreshRunState(client, run.id);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function blockExecutionStep(input = {}) {
  await ensureExecutionRunStorage();
  if (!String(input.blocked_reason || '').trim()) throw new Error('blocked_reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { run, step } = await getRunStepForUpdate(client, input);
    await client.query(`
      UPDATE atlas_execution_run_steps
      SET status='blocked',
          blocked_reason=$3,
          result_summary=CASE WHEN $4::boolean THEN $5 ELSE result_summary END,
          updated_at=now()
      WHERE id=$1::uuid AND run_id=$2::uuid
    `, [
      step.id,
      run.id,
      String(input.blocked_reason).trim(),
      input.result_summary !== undefined,
      input.result_summary ?? null
    ]);
    if (input.last_checkpoint_id) {
      await client.query(`
        UPDATE atlas_execution_runs
        SET last_checkpoint_id=$2::uuid, updated_at=now()
        WHERE id=$1::uuid
      `, [run.id, input.last_checkpoint_id]);
    }
    await logRunEvent(client, {
      runId: run.id,
      stepId: step.id,
      eventType: 'step_blocked',
      details: { step_key: step.step_key, blocked_reason: String(input.blocked_reason).trim() }
    });
    const refreshed = await refreshRunState(client, run.id);
    await client.query('COMMIT');
    return shapeRunResponse(refreshed.run, refreshed.steps);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reportExecutionProgress(locator = {}) {
  const run = await getExecutionRun(locator);
  return run.progress;
}

export async function resumeExecutionRun(locator = {}) {
  const run = await getExecutionRun(locator);
  const session = run.session_id || run.session_resume_handle
    ? await import('./control-plane-store.js').then(module => module.resumeSession({
      session_id: run.session_id || undefined,
      resume_handle: run.session_resume_handle || undefined
    }))
    : null;
  return {
    ...run,
    resumed_session: session
  };
}

export async function listExecutionRunEvents({ run_id, limit = 20 } = {}) {
  await ensureExecutionRunStorage();
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const params = [userId()];
  let filter = '';
  if (run_id) {
    params.push(run_id);
    filter = ` AND run_id=$${params.length}::uuid`;
  }
  params.push(n);
  const { rows } = await pool.query(`
    SELECT id::text, run_id::text, step_id::text, event_type, details, created_at
    FROM atlas_execution_run_events
    WHERE user_id=$1${filter}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `, params);
  return rows;
}

export async function closeExecutionRunPool() {
  await pool.end();
}
