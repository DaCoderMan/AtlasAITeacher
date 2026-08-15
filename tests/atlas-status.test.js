import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAtlasStatusFromDashboard } from '../lib/atlas-store.js';

test('atlas status is derived from the canonical dashboard model', () => {
  const status = buildAtlasStatusFromDashboard({
    generated_at: '2026-08-15T10:00:00Z',
    daily_brief: {
      active_projects: 3,
      unmapped_projects: 1,
      major_wip: 2,
      open_tasks: 7,
      blocked_or_waiting: 2
    },
    today: {
      recommended_next_action: {
        task_id: 't1',
        project_id: 'p1',
        title: 'Ship canonical dashboard layer',
        due_at: '2026-08-16T00:00:00Z'
      }
    },
    automations: {
      routing: {
        pending: 4,
        done: 6
      }
    },
    recent_important_changes: [
      { type: 'task', id: 't2', project_id: 'p2', title: 'Follow-up task', priority: 4, status: 'pending' }
    ],
    release_gate: { status: 'open' },
    execution_runs: { active: [{ id: 'run-1' }] },
    system_health: { overall: 'partial' }
  });

  assert.equal(status.source, 'atlas_dashboard');
  assert.equal(status.projects[0].count, 3);
  assert.equal(status.tasks[0].count, 7);
  assert.equal(status.routing[0].status, 'pending');
  assert.equal(status.top_tasks[0].id, 't1');
  assert.equal(status.top_tasks[0].status, 'recommended_next_action');
  assert.equal(status.top_tasks[1].id, 't2');
  assert.equal(status.release_gate.status, 'open');
  assert.equal(status.execution_runs[0].id, 'run-1');
});
