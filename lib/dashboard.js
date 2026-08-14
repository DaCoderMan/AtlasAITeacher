import { atlasProjects, atlasTasks } from './atlas-store.js';
import { getAutomationStatus } from './auto-ingest.js';
import { checkSystemHealth } from './system-health.js';
import { buildTodayPlan } from './today-engine.js';
import { listAgents } from './agent-registry.js';
import { listProjectManifests } from './manifests.js';

function activeWip(projects) {
  return projects.filter(project => ['Building', 'Testing'].includes(project.status));
}

function blockers(tasks) {
  return tasks
    .filter(task => task.blocker || String(task.status || '').toLowerCase() === 'waiting')
    .map(task => ({ task_id: task.id, project_id: task.project_id || null, title: task.title, blocker: task.blocker || 'waiting', priority: task.priority }));
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

export async function getAtlasDashboard({ now = new Date().toISOString(), active_project_id = null } = {}) {
  const [projects, tasks, automation, system_health] = await Promise.all([
    atlasProjects({ limit: 100 }),
    atlasTasks({ limit: 100 }),
    getAutomationStatus(),
    checkSystemHealth()
  ]);
  const commitments = scheduledCommitments(tasks, new Date(now));
  const today = buildTodayPlan({ tasks, projects, commitments, now, active_project_id });
  const wip = activeWip(projects);
  const blocked = blockers(tasks);
  const healthyAgents = listAgents().map(agent => ({ id: agent.id, name: agent.name, status: 'registered', capabilities: agent.capabilities }));
  const recentImportant = tasks
    .filter(task => task.status !== 'done')
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, 8)
    .map(task => ({ type: 'task', id: task.id, title: task.title, project_id: task.project_id || null, priority: task.priority, updated_at: task.updated_at }));

  return {
    generated_at: new Date().toISOString(),
    daily_brief: {
      open_tasks: tasks.filter(task => task.status !== 'done').length,
      active_projects: projects.filter(project => !['Archived', 'Paused'].includes(project.status)).length,
      major_wip: wip.length,
      blocked_or_waiting: blocked.length,
      commitments_today: commitments.length,
      system_health: system_health.overall
    },
    recommended_next_action: today.recommended_next_action,
    today,
    active_wip_projects: wip,
    blockers_waiting: blocked,
    calendar_today: {
      source: commitments.length ? 'neon_scheduled_tasks' : 'no_verified_calendar_feed',
      commitments,
      warning: commitments.length ? null : 'Google Calendar is authoritative but no live Calendar feed is represented in this runtime unless a connector sync populates canonical state.'
    },
    agents: healthyAgents,
    system_health,
    automations: automation,
    recent_important_changes: recentImportant,
    manifests: listProjectManifests().map(manifest => ({ id: manifest.id, name: manifest.name, lifecycle: manifest.lifecycle, active_agent: manifest.active_agent }))
  };
}
