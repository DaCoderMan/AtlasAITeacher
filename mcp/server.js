#!/usr/bin/env node
import readline from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  atlasSearch,
  atlasContext,
  atlasStatus,
  atlasProjects,
  atlasTasks,
  atlasCreateTask,
  atlasUpdateTask,
  atlasUpdateProject,
  atlasRemember,
  closeAtlasStorePool
} from '../lib/atlas-store.js';
import { atlasConnectors, closeConnectorRegistryPool } from '../lib/connector-registry.js';
import { ingestEvent } from '../lib/ingestion.js';
import { enqueueSourceEvent, processQueuedEvents, getAutomationStatus, closeAutoIngestPool } from '../lib/auto-ingest.js';
import { reconcileAtlas, closeReconciliationPool } from '../lib/reconciliation.js';
import { retryRoutes, closeRouteExecutorPool } from '../lib/route-executor.js';
import { withMutationMetadata } from '../lib/mutation-metadata.js';
import { listProjectManifests, getProjectManifest } from '../lib/manifests.js';
import { resolveContext } from '../lib/context-resolver.js';
import { listAgents } from '../lib/agent-registry.js';
import { routeAgent } from '../lib/router.js';
import { checkSystemHealth, closeSystemHealthPool } from '../lib/system-health.js';
import { getAtlasDashboard } from '../lib/dashboard.js';
import { runCriticQA } from '../lib/critic.js';
import {
  routeAndRecord,
  criticAndRecord,
  healthAndRecord,
  todayAndRecord,
  getControlPlaneActivity,
  closeControlPlanePool
} from '../lib/control-plane-store.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_SAFE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const contextSchema = {
  type: 'object',
  properties: {
    explicit_project: { type: 'string' }, active_project: { type: 'string' }, conversation_project: { type: 'string' },
    canonical_project: { type: 'string' }, global_project: { type: 'string' }, modality: { type: 'string', enum: ['text', 'voice'] },
    last_verified_at: { type: 'string' }
  },
  additionalProperties: false
};

const routeSchema = {
  type: 'object',
  properties: {
    resolved_context: { type: 'object' }, intent: { type: 'string' }, mode: { type: 'string' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] }, language: { type: 'string' },
    service_health: { type: 'array', items: { type: 'object' } }
  },
  required: ['intent'], additionalProperties: false
};

const qaSchema = {
  type: 'object',
  properties: {
    requirements: { type: 'array', items: {} }, evidence: { type: 'array', items: { type: 'object' } }, tests: { type: 'array', items: { type: 'object' } },
    resolved_context: { type: 'object' }, claimed_project_id: { type: 'string' }, dependencies: { type: 'array', items: { type: 'object' } }, contradictions: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: false
};

export const toolDefinitions = [
  { name: 'atlas_search', description: 'Search Atlas canonical projects, tasks, and extracted knowledge.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'], additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_context', description: 'Load relevant canonical Atlas project context, tasks, recent extractions, and optional search results.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_status', description: 'Get compact Atlas operational status: project/task counts, routing counts, and highest-priority open tasks.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_connectors', description: 'List canonical connector installation records with auth state, scopes, capabilities, risk classes, health and remediation.', inputSchema: { type: 'object', properties: { include_unconfigured: { type: 'boolean' } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_projects', description: 'List canonical Atlas projects, optionally filtered by status.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_tasks', description: 'List canonical Atlas tasks, optionally filtered by status or project.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, project_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_manifests', description: 'List Atlas Project Manifest v1 records or retrieve one by ID, slug, or name.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_resolve_context', description: 'Resolve project scope using explicit > active > conversation > canonical > global precedence. Voice does not alter scope.', inputSchema: contextSchema, annotations: READ_ONLY },
  { name: 'atlas_agents', description: 'List registered Atlas specialist agent contracts.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_route', description: 'Preview deterministic specialist/workflow routing while respecting project scope, risk, and dependency health.', inputSchema: routeSchema, annotations: READ_ONLY },
  { name: 'atlas_route_record', description: 'Route an intent and persist the auditable routing decision in canonical Atlas state.', inputSchema: routeSchema, annotations: WRITE_SAFE },
  { name: 'atlas_system_health', description: 'Live-check Atlas dependencies. Configuration alone never reports a service as healthy.', inputSchema: { type: 'object', properties: { timeout_ms: { type: 'integer', minimum: 250, maximum: 10000 } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_system_health_record', description: 'Live-check Atlas dependencies and persist the health observations.', inputSchema: { type: 'object', properties: { timeout_ms: { type: 'integer', minimum: 250, maximum: 10000 } }, additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_today', description: 'Generate an explainable next-action plan from canonical projects/tasks and verified scheduled task commitments.', inputSchema: { type: 'object', properties: { now: { type: 'string' }, active_project_id: { type: 'string' } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_today_record', description: 'Generate and persist today’s explainable Atlas plan.', inputSchema: { type: 'object', properties: { now: { type: 'string' }, active_project_id: { type: 'string' }, max_major_wip: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_dashboard', description: 'Return the Atlas dashboard backend model: Daily Brief, next action, WIP, blockers, calendar state, agents, QA, conflicts, health, automations and recent state.', inputSchema: { type: 'object', properties: { now: { type: 'string' }, active_project_id: { type: 'string' } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_control_plane_activity', description: 'Inspect persisted agent routing, QA runs, health observations, daily plans and open conflicts.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_critic_qa', description: 'Run the independent Atlas QA gate over requirements, evidence, tests, scope, dependencies and contradictions.', inputSchema: qaSchema, annotations: READ_ONLY },
  { name: 'atlas_critic_qa_record', description: 'Run Critic/QA and persist the auditable QA result.', inputSchema: qaSchema, annotations: WRITE_SAFE },
  {
    name: 'atlas_ingest',
    description: 'Evaluate a conversation, file, voice transcript, or external interaction immediately through Atlas Universal Ingestion.',
    inputSchema: {
      type: 'object', properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' }, actor: { type: 'string' },
        occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' },
        language: { type: 'string' }, provenance: { type: 'object' }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' }
      }, required: ['source', 'text'], additionalProperties: false
    }, annotations: WRITE_SAFE
  },
  {
    name: 'atlas_enqueue',
    description: 'Put a source event into durable automatic ingestion with deduplication, retries, source health and routing audit.',
    inputSchema: {
      type: 'object', properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' }, actor: { type: 'string' },
        occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' }, content_text: { type: 'string' }, project_hint: { type: 'string' },
        sensitivity: { type: 'string' }, language: { type: 'string' }, provenance: { type: 'object' }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' }
      }, required: ['source'], additionalProperties: false
    }, annotations: { ...WRITE_SAFE, idempotentHint: true }
  },
  { name: 'atlas_automation_status', description: 'Inspect automatic-ingestion queue, routing status, stuck work, and source health.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'atlas_run_worker', description: 'Process queued Atlas ingestion events now; stale locks and newly configured connector routes are recovered first.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, stale_minutes: { type: 'integer', minimum: 1, maximum: 1440 } }, additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_retry_routes', description: 'Requeue configured deferred routes and optionally retry failed destination deliveries.', inputSchema: { type: 'object', properties: { include_failed: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_reconcile', description: 'Reconcile automation, recover deterministic stale work, surface degraded sources/routes, and record duplicate/conflict candidates.', inputSchema: { type: 'object', properties: { staleSourceMinutes: { type: 'integer', minimum: 5, maximum: 10080 }, repair: { type: 'boolean' } }, additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_remember', description: 'Submit durable information to Atlas for classification, deduplication, provenance and canonical routing.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' }, source: { type: 'string' }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' } }, required: ['text'], additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_create_task', description: 'Create a canonical Atlas task through the controlled storage gateway.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, project_id: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, due_at: { type: 'string' }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' } }, required: ['title'], additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_update_task', description: 'Update a canonical Atlas task through the controlled storage gateway. Omitted fields are preserved; nullable fields can be cleared with null.', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, title: { type: ['string','null'] }, description: { type: ['string','null'] }, status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'waiting', 'cancelled'] }, priority: { type: 'integer', minimum: 1, maximum: 5 }, project_id: { type: ['string','null'] }, due_at: { type: ['string','null'] }, scheduled_start: { type: ['string','null'] }, scheduled_end: { type: ['string','null'] }, blocker: { type: ['string','null'] }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false }, annotations: WRITE_SAFE },
  { name: 'atlas_update_project', description: 'Update an existing canonical Atlas project without bypassing storage and ingestion rules.', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, next_action: { type: ['string','null'] }, blockers: { type: ['string','null'] }, objective: { type: ['string','null'] }, idempotency_key: { type: 'string' }, correlation_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false }, annotations: WRITE_SAFE }
];

export async function dispatchTool(name, args = {}) {
  switch (name) {
    case 'atlas_search': return atlasSearch(args);
    case 'atlas_context': return atlasContext(args);
    case 'atlas_status': return atlasStatus();
    case 'atlas_connectors': return atlasConnectors(args);
    case 'atlas_projects': return atlasProjects(args);
    case 'atlas_tasks': return atlasTasks(args);
    case 'atlas_manifests': return args.project ? getProjectManifest(args.project) : listProjectManifests();
    case 'atlas_resolve_context': return resolveContext(args);
    case 'atlas_agents': return listAgents();
    case 'atlas_route': return routeAgent(args);
    case 'atlas_route_record': return routeAndRecord(args);
    case 'atlas_system_health': return checkSystemHealth(args);
    case 'atlas_system_health_record': return healthAndRecord(args);
    case 'atlas_today': return (await getAtlasDashboard(args)).today;
    case 'atlas_today_record': return todayAndRecord(args);
    case 'atlas_dashboard': return getAtlasDashboard(args);
    case 'atlas_control_plane_activity': return getControlPlaneActivity(args);
    case 'atlas_critic_qa': return runCriticQA(args);
    case 'atlas_critic_qa_record': return criticAndRecord(args);
    case 'atlas_ingest': {
      const input = withMutationMetadata(args, { operation: 'atlas_ingest', defaultActor: 'codex' });
      return ingestEvent({
        source: input.source,
        source_event_id: input.source_event_id,
        thread_id: input.thread_id,
        session_id: input.session_id,
        actor: input.actor,
        occurred_at: input.occurred_at,
        content_type: input.content_type || 'text',
        content_text: input.text,
        project_hint: input.project_hint,
        sensitivity: input.sensitivity,
        language: input.language,
        provenance: input.provenance || {}
      });
    }
    case 'atlas_enqueue': {
      const input = withMutationMetadata(args, { operation: 'atlas_enqueue', defaultActor: 'codex' });
      return enqueueSourceEvent({ ...input, content_text: input.content_text || input.text, actor: input.actor });
    }
    case 'atlas_automation_status': return getAutomationStatus();
    case 'atlas_run_worker': return processQueuedEvents({ limit: args.limit || 25, stale_minutes: args.stale_minutes || 10 });
    case 'atlas_retry_routes': return retryRoutes({ include_failed: args.include_failed !== false, limit: args.limit || 100 });
    case 'atlas_reconcile': return reconcileAtlas({ staleSourceMinutes: args.staleSourceMinutes || 180, repair: args.repair !== false });
    case 'atlas_remember': return atlasRemember(args);
    case 'atlas_create_task': return atlasCreateTask(args);
    case 'atlas_update_task': return atlasUpdateTask(args);
    case 'atlas_update_project': return atlasUpdateProject(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function resultContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'atlas', version: '2.0.0' },
        instructions: 'Atlas is the canonical project-aware orchestration, context, persistence, planning, QA and ingestion gateway. Resolve scope before significant work, inspect health instead of assuming connectivity, use Critic/QA for important completion claims, and persist meaningful routing/planning/results when permissions allow.'
      }
    });
    return;
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: toolDefinitions } });
    return;
  }
  if (message.method === 'tools/call') {
    try {
      const value = await dispatchTool(message.params?.name, message.params?.arguments || {});
      send({ jsonrpc: '2.0', id: message.id, result: resultContent(value) });
    } catch (error) {
      send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: error?.message || String(error) }] } });
    }
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

if (isDirectExecution()) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    if (!line.trim()) return;
    try { await handle(JSON.parse(line)); }
    catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error?.message || 'Parse error' } }); }
  });
  const shutdown = async () => {
    await Promise.allSettled([
      closeAtlasStorePool(), closeConnectorRegistryPool(), closeAutoIngestPool(), closeReconciliationPool(), closeRouteExecutorPool(), closeSystemHealthPool(), closeControlPlanePool()
    ]);
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
