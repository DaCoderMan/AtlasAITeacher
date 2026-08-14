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
  atlasUpdateProject,
  atlasRemember,
  closeAtlasStorePool
} from '../lib/atlas-store.js';
import { ingestEvent } from '../lib/ingestion.js';
import { enqueueSourceEvent, processQueuedEvents, getAutomationStatus, closeAutoIngestPool } from '../lib/auto-ingest.js';
import { reconcileAtlas, closeReconciliationPool } from '../lib/reconciliation.js';
import { listProjectManifests, getProjectManifest } from '../lib/manifests.js';
import { resolveContext } from '../lib/context-resolver.js';
import { listAgents } from '../lib/agent-registry.js';
import { routeAgent } from '../lib/router.js';
import { checkSystemHealth, closeSystemHealthPool } from '../lib/system-health.js';
import { getAtlasDashboard } from '../lib/dashboard.js';
import { runCriticQA } from '../lib/critic.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_SAFE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const toolDefinitions = [
  {
    name: 'atlas_search',
    description: 'Search Atlas canonical projects, tasks, and extracted knowledge.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'], additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_context',
    description: 'Load relevant canonical Atlas project context, tasks, recent extractions, and optional search results.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_status',
    description: 'Get compact Atlas operational status: project/task counts, routing counts, and highest-priority open tasks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_projects',
    description: 'List canonical Atlas projects, optionally filtered by status.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_tasks',
    description: 'List canonical Atlas tasks, optionally filtered by status or project.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, project_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_manifests',
    description: 'List Atlas Project Manifest v1 records or retrieve one by ID, slug, or name.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_resolve_context',
    description: 'Resolve Atlas project scope using explicit > active > conversation > canonical > global precedence. Voice does not change project scope.',
    inputSchema: {
      type: 'object',
      properties: {
        explicit_project: { type: 'string' }, active_project: { type: 'string' }, conversation_project: { type: 'string' },
        canonical_project: { type: 'string' }, global_project: { type: 'string' }, modality: { type: 'string', enum: ['text', 'voice'] },
        last_verified_at: { type: 'string' }
      },
      additionalProperties: false
    },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_agents',
    description: 'List registered Atlas specialist agent contracts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_route',
    description: 'Deterministically choose the Atlas specialist/workflow for an intent while respecting resolved project scope, risk, and dependency health.',
    inputSchema: {
      type: 'object',
      properties: {
        resolved_context: { type: 'object' }, intent: { type: 'string' }, mode: { type: 'string' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] }, language: { type: 'string' }, service_health: { type: 'array', items: { type: 'object' } }
      },
      required: ['intent'], additionalProperties: false
    },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_system_health',
    description: 'Live-check Atlas dependencies. Configuration alone never reports a service as healthy.',
    inputSchema: { type: 'object', properties: { timeout_ms: { type: 'integer', minimum: 250, maximum: 10000 } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_today',
    description: 'Generate an explainable next-action plan from canonical projects/tasks plus verified scheduled task commitments.',
    inputSchema: { type: 'object', properties: { now: { type: 'string' }, active_project_id: { type: 'string' } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_dashboard',
    description: 'Return the Atlas dashboard backend model: Daily Brief, next action, WIP, blockers, calendar state, agents, health, automation and recent important state.',
    inputSchema: { type: 'object', properties: { now: { type: 'string' }, active_project_id: { type: 'string' } }, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_critic_qa',
    description: 'Run the independent Atlas QA gate over requirements, evidence, test results, scope, dependencies and contradictions.',
    inputSchema: {
      type: 'object',
      properties: {
        requirements: { type: 'array', items: {} }, evidence: { type: 'array', items: { type: 'object' } }, tests: { type: 'array', items: { type: 'object' } },
        resolved_context: { type: 'object' }, claimed_project_id: { type: 'string' }, dependencies: { type: 'array', items: { type: 'object' } }, contradictions: { type: 'array', items: { type: 'object' } }
      },
      additionalProperties: false
    },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_ingest',
    description: 'Evaluate a conversation, file, voice transcript, or external interaction immediately through Atlas Universal Ingestion.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' },
        actor: { type: 'string' }, occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' },
        project_hint: { type: 'string' }, sensitivity: { type: 'string' }, language: { type: 'string' }, provenance: { type: 'object' }
      },
      required: ['source', 'text'], additionalProperties: false
    },
    annotations: WRITE_SAFE
  },
  {
    name: 'atlas_enqueue',
    description: 'Put a source event into durable Atlas automatic ingestion with deduplication, retries, source health and routing audit.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' },
        actor: { type: 'string' }, occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' },
        content_text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' }, language: { type: 'string' }, provenance: { type: 'object' }
      },
      required: ['source'], additionalProperties: false
    },
    annotations: { ...WRITE_SAFE, idempotentHint: true }
  },
  {
    name: 'atlas_automation_status',
    description: 'Inspect Atlas automatic-ingestion queue, routing status, and source health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'atlas_run_worker',
    description: 'Process queued Atlas ingestion events now. Normal deployments should use the daemon or scheduler.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: WRITE_SAFE
  },
  {
    name: 'atlas_reconcile',
    description: 'Check Atlas automation consistency, stuck/dead queue work, failed routes, degraded sources, and stale feeds.',
    inputSchema: { type: 'object', properties: { staleSourceMinutes: { type: 'integer', minimum: 5, maximum: 10080 } }, additionalProperties: false },
    annotations: WRITE_SAFE
  },
  {
    name: 'atlas_remember',
    description: 'Submit durable information to Atlas for classification, deduplication, provenance and canonical routing.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' }, source: { type: 'string' } }, required: ['text'], additionalProperties: false },
    annotations: WRITE_SAFE
  },
  {
    name: 'atlas_create_task',
    description: 'Create a canonical Atlas task through the controlled storage gateway.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, project_id: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, due_at: { type: 'string' } }, required: ['title'], additionalProperties: false },
    annotations: WRITE_SAFE
  },
  {
    name: 'atlas_update_project',
    description: 'Update an existing canonical Atlas project without bypassing Atlas storage and ingestion rules.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, next_action: { type: ['string','null'] }, blockers: { type: ['string','null'] }, objective: { type: ['string','null'] } }, required: ['project_id'], additionalProperties: false },
    annotations: WRITE_SAFE
  }
];

export async function dispatchTool(name, args = {}) {
  switch (name) {
    case 'atlas_search': return atlasSearch(args);
    case 'atlas_context': return atlasContext(args);
    case 'atlas_status': return atlasStatus();
    case 'atlas_projects': return atlasProjects(args);
    case 'atlas_tasks': return atlasTasks(args);
    case 'atlas_manifests': return args.project ? getProjectManifest(args.project) : listProjectManifests();
    case 'atlas_resolve_context': return resolveContext(args);
    case 'atlas_agents': return listAgents();
    case 'atlas_route': return routeAgent(args);
    case 'atlas_system_health': return checkSystemHealth(args);
    case 'atlas_today': return (await getAtlasDashboard(args)).today;
    case 'atlas_dashboard': return getAtlasDashboard(args);
    case 'atlas_critic_qa': return runCriticQA(args);
    case 'atlas_ingest': return ingestEvent({
      source: args.source,
      source_event_id: args.source_event_id,
      thread_id: args.thread_id,
      session_id: args.session_id,
      actor: args.actor || 'codex',
      occurred_at: args.occurred_at,
      content_type: args.content_type || 'text',
      content_text: args.text,
      project_hint: args.project_hint,
      sensitivity: args.sensitivity,
      language: args.language,
      provenance: args.provenance || {}
    });
    case 'atlas_enqueue': return enqueueSourceEvent({ ...args, content_text: args.content_text || args.text, actor: args.actor || 'codex' });
    case 'atlas_automation_status': return getAutomationStatus();
    case 'atlas_run_worker': return processQueuedEvents({ limit: args.limit || 25 });
    case 'atlas_reconcile': return reconcileAtlas({ staleSourceMinutes: args.staleSourceMinutes || 180 });
    case 'atlas_remember': return atlasRemember(args);
    case 'atlas_create_task': return atlasCreateTask(args);
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
        instructions: 'Atlas is the canonical project-aware orchestration, context, persistence, planning, QA and ingestion gateway. Resolve project scope before significant work, inspect health instead of assuming connectivity, use Critic/QA for important completion claims, and persist meaningful outcomes through Atlas.'
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

  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

if (isDirectExecution()) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    if (!line.trim()) return;
    try { await handle(JSON.parse(line)); }
    catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error?.message || 'Parse error' } }); }
  });
  const shutdown = async () => {
    await Promise.allSettled([closeAtlasStorePool(), closeAutoIngestPool(), closeReconciliationPool(), closeSystemHealthPool()]);
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
