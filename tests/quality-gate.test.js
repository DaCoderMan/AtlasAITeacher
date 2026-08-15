import test from 'node:test';
import assert from 'node:assert/strict';
import { getQualityGateStatus } from '../lib/quality-gate.js';
import { routeAgent } from '../lib/router.js';
import { resolveContext } from '../lib/context-resolver.js';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test('quality gate fails closed when evidence is missing', () => {
  delete process.env.ATLAS_QUALITY_EVAL_AT;
  delete process.env.ATLAS_QUALITY_EVAL_SCORE;
  process.env.ATLAS_OPTIMIZATION_MODE = 'live';
  process.env.ATLAS_EXPERIMENTAL_ROUTING_MODE = 'live';
  process.env.ATLAS_TRANSCRIPT_ENRICHMENT_ENABLED = 'true';

  const gate = getQualityGateStatus({ now: '2026-08-15T12:00:00Z' });
  assert.equal(gate.mode, 'enforce');
  assert.equal(gate.controls.optimizations.enabled, false);
  assert.equal(gate.controls.experimental_routing.enabled, false);
  assert.equal(gate.controls.transcript_enrichment.enabled, false);
  assert.equal(gate.controls.experimental_routing.reason, 'experimental_routing_requires_current_quality_evidence');
});

test('quality gate enables requested controls when evidence is fresh and above floor', () => {
  process.env.ATLAS_QUALITY_EVAL_ID = 'eval-1';
  process.env.ATLAS_QUALITY_EVAL_AT = '2026-08-15T10:00:00Z';
  process.env.ATLAS_QUALITY_EVAL_SCORE = '0.93';
  process.env.ATLAS_QUALITY_FLOOR = '0.9';
  process.env.ATLAS_OPTIMIZATION_MODE = 'shadow';
  process.env.ATLAS_EXPERIMENTAL_ROUTING_MODE = 'shadow';
  process.env.ATLAS_TRANSCRIPT_ENRICHMENT_ENABLED = 'true';
  process.env.ATLAS_OPTIMIZATION_LATENCY_MS_P50 = '420';
  process.env.ATLAS_OPTIMIZATION_COST_PER_1K_TOKENS = '0.18';

  const gate = getQualityGateStatus({ now: '2026-08-15T12:00:00Z' });
  assert.equal(gate.controls.optimizations.enabled, true);
  assert.equal(gate.controls.optimizations.mode, 'shadow');
  assert.equal(gate.controls.experimental_routing.enabled, true);
  assert.equal(gate.controls.transcript_enrichment.enabled, true);
  assert.equal(gate.evaluation.eval_id, 'eval-1');
});

test('router falls back to baseline when experimental routing is requested without quality evidence', () => {
  process.env.ATLAS_EXPERIMENTAL_ROUTING_MODE = 'live';
  const context = resolveContext({ active_project: 'Atlas' });
  const routed = routeAgent({ resolved_context: context, intent: 'deploy the API', risk: 'medium' });
  assert.equal(routed.routing_controls.mode, 'baseline');
  assert.ok(routed.warnings.some(item => item.type === 'experimental_routing_blocked'));
});

test('router exposes experiment mode only when the quality gate is satisfied', () => {
  process.env.ATLAS_QUALITY_EVAL_AT = '2026-08-15T11:30:00Z';
  process.env.ATLAS_QUALITY_EVAL_SCORE = '0.91';
  process.env.ATLAS_EXPERIMENTAL_ROUTING_MODE = 'shadow';
  const context = resolveContext({ active_project: 'Atlas' });
  const routed = routeAgent({ resolved_context: context, intent: 'deploy the API', risk: 'medium' });
  assert.equal(routed.routing_controls.mode, 'shadow');
  assert.equal(routed.routing_controls.experiment.enabled, true);
});
