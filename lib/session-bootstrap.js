import { resolveContext } from './context-resolver.js';
import { getProjectManifest } from './manifests.js';

const CLIENT_TYPES = new Set(['codex', 'chatgpt', 'api', 'unknown']);
const AUTH_MODES = new Set(['oauth', 'legacy-secret', 'read_only', 'unauthenticated', 'unknown']);

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
    .map(item => ({
      service_id: item.service_id,
      execution_plane: item.execution_plane || null,
      health: item.health,
      failure_summary: item.failure_summary || null
    }));

  return {
    checked_at: nowIso,
    last_verified_at: resolvedContext?.last_verified_at || null,
    warnings,
    degraded_dependencies,
    health_planes: dashboard?.system_health?.planes || null
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

export function normalizeClientProfile(input = {}) {
  const requestedClientType = String(input.client_type || input.client_profile?.client_type || 'unknown').trim().toLowerCase();
  const requestedAuthMode = String(input.auth_mode || input.client_profile?.auth_mode || 'unknown').trim().toLowerCase();
  return {
    client_type: CLIENT_TYPES.has(requestedClientType) ? requestedClientType : 'unknown',
    auth_mode: AUTH_MODES.has(requestedAuthMode) ? requestedAuthMode : 'unknown',
    client_label: input.client_label || input.client_profile?.client_label || null,
    modality: input.modality || input.client_profile?.modality || 'text'
  };
}

function baseClientSupport(profile = {}) {
  switch (profile.client_type) {
    case 'codex':
      return { local_files: true, local_shell: true, voice_transcript_ingest: true, raw_voice_capture: false };
    case 'chatgpt':
      return { local_files: false, local_shell: false, voice_transcript_ingest: true, raw_voice_capture: false };
    case 'api':
      return { local_files: false, local_shell: false, voice_transcript_ingest: true, raw_voice_capture: false };
    default:
      return { local_files: false, local_shell: false, voice_transcript_ingest: true, raw_voice_capture: false };
  }
}

export function buildClientCapabilityEnvelope({ input = {}, capability_snapshot = {}, previous_profile = null } = {}) {
  const profile = normalizeClientProfile(input);
  const supports = {
    ...baseClientSupport(profile),
    device_independent_resume: true,
    atlas_write: !['read_only', 'unauthenticated'].includes(profile.auth_mode)
  };
  const degraded_capabilities = [];
  if (!supports.local_files) degraded_capabilities.push({ capability: 'local_files', status: 'unavailable', reason: `${profile.client_type}_does_not_expose_local_files` });
  if (!supports.local_shell) degraded_capabilities.push({ capability: 'local_shell', status: 'unavailable', reason: `${profile.client_type}_does_not_expose_local_shell` });
  if (profile.modality === 'voice' && !supports.raw_voice_capture) {
    degraded_capabilities.push({ capability: 'raw_voice_capture', status: 'unavailable', reason: 'voice_sessions_require_transcript_artifacts_not_raw_audio' });
  }
  if (!supports.atlas_write) {
    degraded_capabilities.push({ capability: 'atlas_write', status: 'unavailable', reason: `${profile.auth_mode}_clients_may_not_mutate_canonical_state` });
  }
  if (profile.auth_mode === 'unknown') {
    degraded_capabilities.push({ capability: 'auth_scope_certainty', status: 'degraded', reason: 'client_auth_mode_not_reported' });
  }

  return {
    profile,
    supports,
    degraded_capabilities,
    allowed_actions: {
      can_resume_session: true,
      can_checkpoint_session: supports.atlas_write,
      can_use_atlas_write: supports.atlas_write
    },
    handoff: {
      previous_client_profile: previous_profile || null,
      current_client_profile: profile,
      client_changed: Boolean(previous_profile && (
        previous_profile.client_type !== profile.client_type
        || previous_profile.auth_mode !== profile.auth_mode
        || previous_profile.modality !== profile.modality
      ))
    },
    capability_snapshot
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
  const client_capabilities = buildClientCapabilityEnvelope({ input, capability_snapshot });

  return {
    version: 'session-context-envelope.v2',
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
    client_capabilities,
    approval_policy: approvalPolicyForContext(resolved_context),
    freshness: freshnessEnvelope(resolved_context, dashboard, now),
    active_execution_run: dashboard?.execution_runs?.active?.[0] || null,
    release_gate: dashboard?.release_gate || null
  };
}

export function buildResumedSessionEnvelope({
  resumed_session,
  input = {},
  capability_snapshot = {}
} = {}) {
  const previousProfile = resumed_session?.context?.client_profile
    || resumed_session?.latest_checkpoint?.checkpoint_state?.client_profile
    || null;
  return {
    ...resumed_session,
    client_capabilities: buildClientCapabilityEnvelope({
      input,
      capability_snapshot,
      previous_profile: previousProfile
    })
  };
}
