#!/usr/bin/env node
import readline from 'node:readline';
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

export const toolDefinitions = [
  {
    name: 'atlas_search',
    description: 'Use this when Codex needs to search Atlas canonical projects, tasks, and extracted knowledge.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_context',
    description: 'Use this before significant work to load relevant Atlas project context, tasks, recent extractions, and optional search results.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_status',
    description: 'Use this to get a compact Atlas operational status: project/task counts, routing queue counts, and highest-priority open tasks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_projects',
    description: 'Use this to list canonical Atlas projects, optionally filtered by status.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_tasks',
    description: 'Use this to list canonical Atlas tasks, optionally filtered by status or project.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, project_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_ingest',
    description: 'Use this when new conversation, file, voice transcript, or external interaction should be evaluated immediately by Atlas Universal Ingestion.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' },
        actor: { type: 'string' }, occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' },
        project_hint: { type: 'string' }, sensitivity: { type: 'string' }, language: { type: 'string' }, provenance: { type: 'object' }
      },
      required: ['source', 'text'], additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'atlas_enqueue',
    description: 'Use this to put a source event into Atlas automatic ingestion. Prefer this for connector and background ingestion so retries and source health are tracked.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, source_event_id: { type: 'string' }, thread_id: { type: 'string' }, session_id: { type: 'string' },
        actor: { type: 'string' }, occurred_at: { type: 'string' }, content_type: { type: 'string' }, text: { type: 'string' },
        content_text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' }, language: { type: 'string' }, provenance: { type: 'object' }
      },
      required: ['source'], additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_automation_status',
    description: 'Use this to inspect Atlas automatic ingestion queue counts and source health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'atlas_run_worker',
    description: 'Use this to process queued Atlas ingestion events now. Normal deployments should also run the daemon or scheduled worker automatically.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'atlas_reconcile',
    description: 'Use this to check Atlas automation consistency, dead letters, failed routes, degraded sources, and stale source feeds.',
    inputSchema: { type: 'object', properties: { staleSourceMinutes: { type: 'integer', minimum: 5, maximum: 10080 } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'atlas_remember',
    description: 'Use this to submit durable information to Atlas for classification, deduplication, and canonical routing.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, project_hint: { type: 'string' }, sensitivity: { type: 'string' }, source: { type: 'string' } }, required: ['text'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'atlas_create_task',
    description: 'Use this to create a canonical Atlas task. Prefer this over direct database writes.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, project_id: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, due_at: { type: 'string' } }, required: ['title'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'atlas_update_project',
    description: 'Use this to update an existing canonical Atlas project without bypassing Atlas storage rules.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 5 }, next_action: { type: ['string','null'] }, blockers: { type: ['string','null'] }, objective: { type: ['string','null'] } }, required: ['project_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
];

export async function dispatchTool(name, args = {}) {
  switch (name) {
    case 'atlas_search': return atlasSearch(args);
    case 'atlas_context': return atlasContext(args);
    case 'atlas_status': return atlasStatus();
    case 'atlas_projects': return atlasProjects(args);
    case 'atlas_tasks': return atlasTasks(args);
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

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'atlas', version: '1.1.0' },
        instructions: 'Atlas is the canonical context, persistence, and automatic-ingestion gateway. Read context before significant work; send meaningful outcomes through Atlas; check automation status when source ingestion matters.'
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    if (!line.trim()) return;
    try { await handle(JSON.parse(line)); }
    catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error?.message || 'Parse error' } }); }
  });
  const shutdown = async () => {
    await Promise.allSettled([closeAtlasStorePool(), closeAutoIngestPool(), closeReconciliationPool()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
