import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { toolDefinitions } from '../mcp/server.js';

const EXPECTED = [
  'atlas_search', 'atlas_context', 'atlas_status', 'atlas_connectors', 'atlas_connector_test_matrix', 'atlas_projects', 'atlas_tasks',
  'atlas_manifests', 'atlas_resolve_context', 'atlas_agents', 'atlas_route',
  'atlas_route_record', 'atlas_system_health', 'atlas_system_health_record',
  'atlas_today', 'atlas_today_record', 'atlas_dashboard', 'atlas_control_plane_activity',
  'atlas_critic_qa', 'atlas_critic_qa_record',
  'atlas_ingest', 'atlas_enqueue', 'atlas_automation_status', 'atlas_run_worker',
  'atlas_retry_routes', 'atlas_reconcile', 'atlas_remember', 'atlas_create_task', 'atlas_update_task', 'atlas_update_project'
];

test('Atlas MCP exposes the expected controlled tool surface', () => {
  assert.deepEqual(toolDefinitions.map(t => t.name), EXPECTED);
});

test('read tools are annotated read-only and write/automation tools are not', () => {
  const read = new Set([
    'atlas_search', 'atlas_context', 'atlas_status', 'atlas_projects', 'atlas_tasks',
    'atlas_connectors', 'atlas_connector_test_matrix',
    'atlas_manifests', 'atlas_resolve_context', 'atlas_agents', 'atlas_route',
    'atlas_system_health', 'atlas_today', 'atlas_dashboard', 'atlas_control_plane_activity',
    'atlas_critic_qa', 'atlas_automation_status'
  ]);
  for (const tool of toolDefinitions) {
    assert.equal(tool.annotations.readOnlyHint, read.has(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
});

test('task update is write-scoped and exposes only controlled fields', () => {
  const tool = toolDefinitions.find(item => item.name === 'atlas_update_task');
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.deepEqual(tool.inputSchema.required, ['task_id']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.sql, undefined);
  assert.equal(tool.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(tool.inputSchema.properties.correlation_id.type, 'string');
});

test('canonical write tools expose mutation journal metadata fields', () => {
  const createTask = toolDefinitions.find(item => item.name === 'atlas_create_task');
  const updateProject = toolDefinitions.find(item => item.name === 'atlas_update_project');
  const ingest = toolDefinitions.find(item => item.name === 'atlas_ingest');
  const enqueue = toolDefinitions.find(item => item.name === 'atlas_enqueue');
  const remember = toolDefinitions.find(item => item.name === 'atlas_remember');
  assert.equal(createTask.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(createTask.inputSchema.properties.correlation_id.type, 'string');
  assert.equal(updateProject.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(updateProject.inputSchema.properties.correlation_id.type, 'string');
  assert.equal(ingest.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(ingest.inputSchema.properties.correlation_id.type, 'string');
  assert.equal(enqueue.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(enqueue.inputSchema.properties.correlation_id.type, 'string');
  assert.equal(remember.inputSchema.properties.idempotency_key.type, 'string');
  assert.equal(remember.inputSchema.properties.correlation_id.type, 'string');
});

test('connector registry tool is read-only and only exposes bounded filter inputs', () => {
  const tool = toolDefinitions.find(item => item.name === 'atlas_connectors');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.include_unconfigured.type, 'boolean');
});

test('connector test matrix tool is read-only and exposes no mutation inputs', () => {
  const tool = toolDefinitions.find(item => item.name === 'atlas_connector_test_matrix');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.properties, {});
});

test('Atlas MCP does not expose raw SQL or shell tools', () => {
  const names = new Set(toolDefinitions.map(tool => tool.name));
  for (const forbidden of ['atlas_sql', 'atlas_query', 'atlas_shell', 'atlas_exec']) {
    assert.equal(names.has(forbidden), false, forbidden);
  }
});

test('dedicated atlas-mcp deploy root keeps MCP rewrites without scheduler cron', () => {
  const config = JSON.parse(readFileSync(new URL('../apps/atlas-mcp/vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites, [
    {
      source: '/.well-known/oauth-protected-resource',
      destination: '/api/oauth-protected-resource'
    }
  ]);
  assert.equal('crons' in config, false);
});

test('stdio MCP handshake and tools/list work without database access', async () => {
  const child = spawn(process.execPath, ['mcp/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/unused' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    for (const line of chunk.split('\n')) if (line.trim()) lines.push(JSON.parse(line));
  });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !lines.some(x => x.id === 2)) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  child.kill('SIGTERM');
  const init = lines.find(x => x.id === 1);
  const listed = lines.find(x => x.id === 2);
  assert.equal(init?.result?.serverInfo?.name, 'atlas');
  assert.equal(typeof init?.result?.capabilities?.tools?.capabilityEpoch, 'string');
  assert.equal(typeof listed?.result?.tool_schema_hash, 'string');
  assert.deepEqual(listed?.result?.tools?.map(t => t.name), EXPECTED);
});
