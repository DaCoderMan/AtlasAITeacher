import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContextEnvelope, approvalPolicyForContext } from '../lib/session-bootstrap.js';

test('approval policy reflects bounded autonomy and QA requirements from resolved context', () => {
  const policy = approvalPolicyForContext({
    scope_invariant: true,
    project: { autonomy: 'bounded', qa_required: true }
  });
  assert.equal(policy.autonomy, 'bounded');
  assert.equal(policy.qa_required, true);
  assert.equal(policy.approval_required_for_high_impact, true);
});

test('session bootstrap envelope returns versioned context goals memory capability snapshot and freshness', () => {
  const envelope = buildSessionContextEnvelope({
    input: { explicit_project: 'Atlas', modality: 'text', last_verified_at: '2026-08-15T00:00:00Z' },
    capability_snapshot: { capability_epoch: 'epoch-1', tool_schema_hash: 'hash-1', scope_profile: 'implicit_or_legacy' },
    atlas_context: {
      tasks: [
        { id: 't1', title: 'Top task', status: 'pending', priority: 5, due_at: '2026-08-16T00:00:00Z', blocker: null },
        { id: 't2', title: 'Done task', status: 'done', priority: 5 }
      ],
      recent_extractions: [
        { kind: 'decision', title: 'Canonical rule', importance: 90, confidence: 0.9, created_at: '2026-08-15T00:00:00Z' }
      ]
    },
    dashboard: {
      persisted_health: [{ service_id: 'github', health: 'degraded', failure_summary: 'rate limited' }],
      system_health: {
        planes: {
          atlas_backend: { health: 'healthy', execution_plane: 'server' },
          connector_runtime: { health: 'degraded', execution_plane: 'connector' },
          host_surface: { health: 'unknown', execution_plane: 'host' }
        }
      },
      release_gate: { status: 'open', enforced: true },
      execution_runs: {
        active: [{ id: 'run-1', run_key: 'codex-job', progress: { progress_message: '1/3 steps' } }]
      }
    },
    now: '2026-08-15T12:00:00Z'
  });
  assert.equal(envelope.version, 'session-context-envelope.v1');
  assert.equal(envelope.resolved_context.project.id, 'atlas');
  assert.equal(envelope.goals[0].task_id, 't1');
  assert.equal(envelope.memory[0].kind, 'decision');
  assert.equal(envelope.capability_snapshot.capability_epoch, 'epoch-1');
  assert.equal(envelope.freshness.degraded_dependencies[0].service_id, 'github');
  assert.equal(envelope.freshness.health_planes.host_surface.health, 'unknown');
  assert.equal(envelope.active_execution_run.id, 'run-1');
  assert.equal(envelope.release_gate.status, 'open');
});
