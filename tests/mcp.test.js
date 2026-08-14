import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { toolDefinitions } from '../mcp/server.js';

const EXPECTED = [
  'atlas_search', 'atlas_context', 'atlas_status', 'atlas_projects', 'atlas_tasks',
  'atlas_ingest', 'atlas_enqueue', 'atlas_automation_status', 'atlas_run_worker',
  'atlas_reconcile', 'atlas_remember', 'atlas_create_task', 'atlas_update_project'
];

test('Atlas MCP exposes the expected controlled tool surface', () => {
  assert.deepEqual(toolDefinitions.map(t => t.name), EXPECTED);
});

test('read tools are annotated read-only and write/automation tools are not', () => {
  const read = new Set(['atlas_search', 'atlas_context', 'atlas_status', 'atlas_projects', 'atlas_tasks', 'atlas_automation_status']);
  for (const tool of toolDefinitions) {
    assert.equal(tool.annotations.readOnlyHint, read.has(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
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
  assert.deepEqual(listed?.result?.tools?.map(t => t.name), EXPECTED);
});
