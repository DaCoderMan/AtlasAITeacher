function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function urgencyScore(task, now) {
  const due = dateValue(task.due_at);
  if (!due) return 10;
  const hours = (due.getTime() - now.getTime()) / 3600000;
  if (hours <= 0) return 100;
  if (hours <= 6) return 90;
  if (hours <= 24) return 80;
  if (hours <= 72) return 65;
  if (hours <= 168) return 45;
  if (hours <= 336) return 30;
  return 15;
}

function durationMinutes(task) {
  return clamp(task.estimated_minutes ?? task.duration_minutes ?? 45, 5, 480);
}

function overlapsCommitment(task, commitments, now) {
  const start = dateValue(task.scheduled_start);
  const end = dateValue(task.scheduled_end);
  if (!start || !end) return false;
  return commitments.some(commitment => {
    const cStart = dateValue(commitment.start || commitment.scheduled_start);
    const cEnd = dateValue(commitment.end || commitment.scheduled_end);
    if (!cStart || !cEnd || cEnd < now) return false;
    return start < cEnd && end > cStart;
  });
}

function scoreTask(task, context) {
  const { now, projectsById, commitments, activeProjectId, majorWipCount, maxMajorWip } = context;
  const project = projectsById.get(task.project_id) || {};
  const evidence = [];
  const components = {};

  components.urgency = urgencyScore(task, now);
  evidence.push({ type: 'task', id: task.id, field: 'due_at', value: task.due_at || null });
  components.task_priority = clamp((Number(task.priority) || 3) * 20);
  evidence.push({ type: 'task', id: task.id, field: 'priority', value: task.priority ?? null });
  components.project_priority = clamp((Number(project.priority) || 3) * 15);
  if (project.id) {
    evidence.push({ type: 'project', id: project.id, field: 'priority', value: project.priority ?? null });
    evidence.push({ type: 'project', id: project.id, field: 'lifecycle', value: project.lifecycle ?? null });
  }

  components.strategic_impact = clamp(task.strategic_impact ?? task.impact ?? 50);
  components.income_impact = clamp(task.income_impact ?? 0);
  components.blocker_release = task.releases_blocker || task.blocker_release ? 80 : 0;
  components.dependency_value = clamp(task.dependency_value ?? 0);

  const waiting = String(task.status || '').toLowerCase() === 'waiting' || Boolean(task.waiting_on);
  components.waiting_penalty = waiting ? -80 : 0;
  if (waiting) evidence.push({ type: 'task', id: task.id, field: 'waiting', value: task.waiting_on || true });

  const conflict = overlapsCommitment(task, commitments, now);
  components.calendar_fit = conflict ? -70 : durationMinutes(task) <= 90 ? 20 : 5;
  if (conflict) evidence.push({ type: 'calendar_conflict', id: task.id });

  components.context_switch = activeProjectId && task.project_id && task.project_id !== activeProjectId ? -12 : 0;
  const proposedMajorBuild = ['Building', 'Testing'].includes(project.lifecycle) && task.starts_major_build;
  components.wip_penalty = proposedMajorBuild && majorWipCount >= maxMajorWip ? -100 : 0;
  if (components.wip_penalty) evidence.push({ type: 'wip_limit', count: majorWipCount, max: maxMajorWip });

  const weighted =
    components.urgency * 0.24 + components.task_priority * 0.18 + components.project_priority * 0.14 +
    components.strategic_impact * 0.16 + components.income_impact * 0.10 + components.blocker_release * 0.08 +
    components.dependency_value * 0.06 + components.calendar_fit * 0.04 + components.waiting_penalty +
    components.context_switch + components.wip_penalty;

  return {
    task,
    score: Math.round(weighted * 100) / 100,
    components,
    evidence,
    blocked: Boolean(task.blocker) || waiting,
    calendar_conflict: conflict,
    duration_minutes: durationMinutes(task)
  };
}

export function buildTodayPlan({ tasks = [], projects = [], commitments = [], now = new Date().toISOString(), active_project_id = null, max_major_wip = 3 } = {}) {
  const nowDate = dateValue(now) || new Date();
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const majorWip = projects.filter(project => ['Building', 'Testing'].includes(project.lifecycle));
  const majorWipCount = majorWip.length;
  const eligible = tasks.filter(task => !['done', 'cancelled', 'archived'].includes(String(task.status || '').toLowerCase()));
  const scored = eligible
    .map(task => scoreTask(task, { now: nowDate, projectsById, commitments, activeProjectId: active_project_id, majorWipCount, maxMajorWip: max_major_wip }))
    .sort((a, b) => b.score - a.score || String(a.task.id).localeCompare(String(b.task.id)));

  const actionable = scored.filter(item => !item.blocked && !item.calendar_conflict && item.components.wip_penalty === 0);
  const recommended = actionable[0] || scored[0] || null;
  const additional = actionable.filter(item => item !== recommended).slice(0, 4);
  const warnings = [];
  if (majorWipCount >= max_major_wip) warnings.push({ type: 'wip_limit_reached', active_major_projects: majorWipCount, max_major_wip, project_ids: majorWip.map(project => project.id) });
  const conflicts = scored.filter(item => item.calendar_conflict);
  if (conflicts.length) warnings.push({ type: 'calendar_conflicts', task_ids: conflicts.map(item => item.task.id) });
  const blocked = scored.filter(item => item.blocked);
  if (blocked.length) warnings.push({ type: 'blocked_or_waiting', task_ids: blocked.map(item => item.task.id) });

  const summarize = item => item ? {
    task_id: item.task.id,
    project_id: item.task.project_id || null,
    title: item.task.title,
    score: item.score,
    score_components: item.components,
    evidence: item.evidence,
    due_at: item.task.due_at || null,
    duration_minutes: item.duration_minutes
  } : null;

  return {
    generated_at: new Date().toISOString(),
    recommended_next_action: summarize(recommended),
    additional_actions: additional.map(summarize),
    commitments,
    blockers: blocked.map(item => ({ task_id: item.task.id, title: item.task.title, blocker: item.task.blocker || item.task.waiting_on || 'waiting' })),
    warnings,
    wip: { major_building_or_testing: majorWipCount, max_major_wip, projects: majorWip.map(project => ({ id: project.id, name: project.name, lifecycle: project.lifecycle })) }
  };
}
