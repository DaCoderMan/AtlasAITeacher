import { resolveContext } from './context-resolver.js';
import { getProjectManifest } from './manifests.js';

function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) =>
    Number(b.priority || 0) - Number(a.priority || 0)
    || String(a.due_at || '').localeCompare(String(b.due_at || ''))
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
  );
}

function summarizeGoals(tasks = [], limit = 5) {
  return sortTasks(tasks)
    .filter(task => !['done', 'cancelled'].includes(String(task.status || '').toLowerCase()))
    .slice(0, limit)
    .map(task => ({
      task_id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_at: task.due_at || null,
      blocker: task.blocker || null
    }));
}

function summarizeMemory(recent_extractions = [], limit = 5) {
  return (recent_extractions || []).slice(0, limit).map(item => ({
    kind: item.kind,
    title: item.title || null,
    importance: item.importance ?? null,
    confidence: item.confidence ?? null,
    created_at: item.created_at || null
  }));
}

function freshnessEnvelope(resolvedContext, dashboard, nowIso) {
  const warnings = [...(resolvedContext?.warnings || [])];
  const latestHealth = dashboard?.persisted_health || [];
  const degraded_dependencies = latestHealth
    .filter(item => item.health && item.health !== 'healthy')
    .map(item => ({ service_id: item.service_id, health: item.health, failure_summary: item.failure_summary || null }));

  return {
    checked_at: nowIso,
    last_verified_at: resolvedContext?.last_verified_at || null,
    warnings,
    degraded_dependencies
  };
}

export function approvalPolicyForContext(resolvedContext) {
  const project = resolvedContext?.project || null;
  return {
    autonomy: project?.autonomy || 'bounded',
    qa_required: project?.qa_required ?? true,
    write_scope: 'atlas.write',
    approval_required_for_high_impact: true,
    scope_invariant: resolvedContext?.scope_invariant !== false
  };
}

export function buildSessionContextEnvelope({
  input = {},
  capability_snapshot,
  atlas_context,
  dashboard,
  now = new Date().toISOString()
} = {}) {
  const manifestHint = input.explicit_project || input.active_project || input.conversation_project || input.canonical_project || input.global_project || null;
  const manifest = getProjectManifest(manifestHint) || null;
  const resolved_context = resolveContext({
    ...input,
    explicit_project: input.explicit_project || manifest?.id || undefined,
    active_project: input.active_project,
    conversation_project: input.conversation_project,
    canonical_project: input.canonical_project,
    global_project: input.global_project,
    modality: input.modality,
    last_verified_at: input.last_verified_at || manifest?.last_verified_at || null
  });

  const projectTasks = (atlas_context?.tasks || []).filter(task =>
    !resolved_context?.project?.id || !task.project_id || task.project_id === resolved_context.project.id || task.project_id === input.active_project_id
  );

  return {
    version: 'session-context-envelope.v1',
    bootstrapped_at: now,
    user: {
      id: process.env.ATLAS_USER_ID || 'default'
    },
    resolved_context,
    manifest: resolved_context.project ? {
      id: resolved_context.project.id,
      slug: resolved_context.project.slug,
      name: resolved_context.project.name,
      lifecycle: resolved_context.project.lifecycle,
      active_agent: resolved_context.project.active_agent,
      authoritative_sources: resolved_context.project.authoritative_sources
    } : null,
    goals: summarizeGoals(projectTasks.length ? projectTasks : (atlas_context?.tasks || [])),
    memory: summarizeMemory(atlas_context?.recent_extractions || []),
    capability_snapshot,
    approval_policy: approvalPolicyForContext(resolved_context),
    freshness: freshnessEnvelope(resolved_context, dashboard, now),
    active_execution_run: dashboard?.execution_runs?.active?.[0] || null,
    release_gate: dashboard?.release_gate || null
  };
}
