import { getProjectManifest } from './manifests.js';

function resolveCandidate(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.id) return getProjectManifest(value.id) || getProjectManifest(value.name);
  return getProjectManifest(value);
}

export function resolveContext(input = {}) {
  const explicit = resolveCandidate(input.explicit_project);
  const active = resolveCandidate(input.active_project);
  const conversation = resolveCandidate(input.conversation_project);
  const canonical = resolveCandidate(input.canonical_project);
  const global = resolveCandidate(input.global_project);

  const selected = explicit || active || conversation || canonical || global || null;
  const source = explicit ? 'explicit_user_project'
    : active ? 'active_project'
      : conversation ? 'conversation_context'
        : canonical ? 'canonical_state'
          : global ? 'global_context'
            : 'unscoped';

  const modality = input.modality === 'voice' ? 'voice' : 'text';
  const warnings = [];
  if (input.explicit_project && !explicit) warnings.push({ type: 'unknown_explicit_project', value: input.explicit_project });
  if (!selected) warnings.push({ type: 'project_scope_unresolved' });
  if (selected && !input.last_verified_at) warnings.push({ type: 'verification_timestamp_missing', project_id: selected.id });

  return {
    project: selected ? {
      id: selected.id,
      slug: selected.slug,
      name: selected.name,
      lifecycle: selected.lifecycle,
      mission: selected.mission,
      active_agent: selected.active_agent,
      allowed_agents: [...selected.allowed_agents],
      memory_namespace: selected.memory_namespace,
      authoritative_sources: [...selected.authoritative_sources],
      do_not_do: [...selected.do_not_do],
      autonomy: selected.autonomy,
      qa_required: selected.qa_required
    } : null,
    source,
    modality,
    scope_invariant: true,
    last_verified_at: input.last_verified_at || null,
    warnings
  };
}
