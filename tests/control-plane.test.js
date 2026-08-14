import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifestRegistry, getProjectManifest, listProjectManifests, validateManifest } from '../lib/manifests.js';
import { resolveContext } from '../lib/context-resolver.js';
import { getAgent, listAgents } from '../lib/agent-registry.js';
import { routeAgent } from '../lib/router.js';
import { buildTodayPlan } from '../lib/today-engine.js';
import { runCriticQA } from '../lib/critic.js';

test('nine initial Atlas project manifests load and Atlas is improving', () => {
  const manifests = listProjectManifests();
  assert.equal(manifests.length, 9);
  assert.equal(getProjectManifest('Atlas').lifecycle, 'Improving');
  assert.equal(getProjectManifest('magic-hebrew').active_agent, 'Magic Hebrew');
});

test('manifest validation rejects unknown lifecycle and duplicate ids', () => {
  const base = getProjectManifest('atlas');
  assert.throws(() => validateManifest({ ...base, lifecycle: 'Imaginary' }), /invalid lifecycle/);
  assert.throws(() => buildManifestRegistry({ lifecycle: ['Improving'], manifests: [{ ...base, lifecycle: 'Improving' }, { ...base, lifecycle: 'Improving', slug: 'atlas-copy', name: 'Atlas copy' }] }), /duplicate manifest id/);
});

test('voice modality does not change Magic Hebrew project scope', () => {
  const text = resolveContext({ active_project: 'Magic Hebrew', modality: 'text', last_verified_at: '2026-08-14T00:00:00Z' });
  const voice = resolveContext({ active_project: 'Magic Hebrew', modality: 'voice', last_verified_at: '2026-08-14T00:00:00Z' });
  assert.equal(text.project.id, 'magic-hebrew');
  assert.equal(voice.project.id, 'magic-hebrew');
  assert.equal(voice.scope_invariant, true);
});

test('explicit project overrides active and conversation project', () => {
  const context = resolveContext({ explicit_project: 'Atlas', active_project: 'Magic Hebrew', conversation_project: 'Career' });
  assert.equal(context.project.id, 'atlas');
  assert.equal(context.source, 'explicit_user_project');
});

test('agent registry contains distinct Builder and Critic QA contracts', () => {
  assert.ok(listAgents().length >= 15);
  assert.notEqual(getAgent('Builder').id, getAgent('Critic/QA').id);
});

test('router honors project allowed-agent restrictions', () => {
  const context = resolveContext({ active_project: 'Magic Hebrew' });
  const routed = routeAgent({ resolved_context: context, intent: 'refactor the Atlas OAuth infrastructure', risk: 'low' });
  assert.equal(routed.selected_agents[0], 'Magic Hebrew');
  assert.equal(routed.rationale.project_scope_applied, true);
});

test('router surfaces degraded required dependency', () => {
  const context = resolveContext({ active_project: 'Atlas' });
  const routed = routeAgent({
    resolved_context: context,
    intent: 'inspect the GitHub repository and deploy the API',
    risk: 'medium',
    service_health: [{ service_id: 'github', health: 'degraded', failure_summary: 'rate limited' }]
  });
  assert.ok(routed.warnings.some(item => item.type === 'capability_degraded' && item.capability === 'github'));
});

test('Today engine recommends an urgent unblocked task and carries evidence', () => {
  const now = '2026-08-14T09:00:00Z';
  const projects = [
    { id: 'p1', status: 'Building', priority: 5 },
    { id: 'p2', status: 'Operational', priority: 3 }
  ];
  const tasks = [
    { id: 't1', project_id: 'p1', title: 'Ship Atlas', status: 'todo', priority: 5, due_at: '2026-08-14T12:00:00Z', strategic_impact: 90 },
    { id: 't2', project_id: 'p2', title: 'Blocked item', status: 'waiting', priority: 5, due_at: '2026-08-14T10:00:00Z', waiting_on: 'external reply' }
  ];
  const plan = buildTodayPlan({ tasks, projects, now });
  assert.equal(plan.recommended_next_action.task_id, 't1');
  assert.ok(plan.recommended_next_action.evidence.some(item => item.type === 'task'));
  assert.ok(plan.blockers.some(item => item.task_id === 't2'));
});

test('Today engine warns at WIP limit', () => {
  const projects = ['p1','p2','p3'].map(id => ({ id, status: 'Building', priority: 3 }));
  const tasks = [{ id: 't1', project_id: 'p1', title: 'Work', status: 'todo', priority: 3 }];
  const plan = buildTodayPlan({ tasks, projects, now: '2026-08-14T09:00:00Z' });
  assert.ok(plan.warnings.some(item => item.type === 'wip_limit_reached'));
});

test('Critic QA fails uncovered requirements and failed tests', () => {
  const qa = runCriticQA({
    requirements: [{ id: 'r1', text: 'must work' }, { id: 'r2', text: 'must be tested' }],
    evidence: [{ criterion_id: 'r1', artifact: 'implementation' }],
    tests: [{ name: 'acceptance', status: 'failed' }]
  });
  assert.equal(qa.status, 'fail');
  assert.ok(qa.findings.some(item => item.type === 'requirements_coverage' && item.criterion_id === 'r2'));
  assert.ok(qa.findings.some(item => item.type === 'test_result'));
});

test('Critic QA passes when criteria are covered and tests pass', () => {
  const qa = runCriticQA({
    requirements: [{ id: 'r1', text: 'works' }],
    evidence: [{ criterion_id: 'r1' }],
    tests: [{ name: 'acceptance', status: 'passed' }],
    resolved_context: { project: { id: 'atlas' }, warnings: [] },
    claimed_project_id: 'atlas',
    dependencies: [{ service_id: 'neon', required: true, health: 'healthy' }]
  });
  assert.equal(qa.status, 'pass');
});
