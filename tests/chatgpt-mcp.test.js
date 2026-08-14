import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { structuredToolContent } from '../api/mcp.js';
import protectedResourceHandler from '../api/oauth-protected-resource.js';
import { toolDefinitions } from '../mcp/server.js';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test('remote MCP wraps list tool structured content in objects for ChatGPT validation', () => {
  const projects = [{ id: 'p1' }];
  const tasks = [{ id: 't1' }];
  const manifests = [{ id: 'm1' }];

  assert.deepEqual(structuredToolContent('atlas_projects', projects), { projects });
  assert.deepEqual(structuredToolContent('atlas_tasks', tasks), { tasks });
  assert.deepEqual(structuredToolContent('atlas_manifests', manifests), { manifests });
  assert.deepEqual(structuredToolContent('atlas_manifests', manifests[0]), manifests[0]);
});

async function call(body) {
  const req = { method: 'POST', headers: {}, body };
  const res = mockResponse();
  process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED = 'true';
  await handler(req, res);
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  return res;
}

test('remote MCP initializes for ChatGPT', async () => {
  const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.serverInfo.name, 'atlas');
});

test('remote MCP exposes same Atlas tools as Codex MCP by default', async () => {
  delete process.env.ATLAS_MCP_REMOTE_READ_ONLY;
  const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.result.tools.map(t => t.name), toolDefinitions.map(t => t.name));
});

test('remote read-only profile exposes only read-only Atlas tools', async () => {
  process.env.ATLAS_MCP_REMOTE_READ_ONLY = 'true';
  const res = await call({ jsonrpc: '2.0', id: 20, method: 'tools/list', params: {} });
  delete process.env.ATLAS_MCP_REMOTE_READ_ONLY;
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.result.tools.length > 0);
  assert.ok(res.body.result.tools.length < toolDefinitions.length);
  assert.ok(res.body.result.tools.every(tool => tool.annotations?.readOnlyHint !== false));
});

test('remote read-only profile blocks mutation calls before dispatch', async () => {
  process.env.ATLAS_MCP_REMOTE_READ_ONLY = 'true';
  const res = await call({
    jsonrpc: '2.0',
    id: 21,
    method: 'tools/call',
    params: { name: 'atlas_create_task', arguments: { title: 'must not be created' } }
  });
  delete process.env.ATLAS_MCP_REMOTE_READ_ONLY;
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.message, 'remote_read_only');
});

test('remote MCP fails closed when no authentication mode is configured', async () => {
  delete process.env.ATLAS_MCP_SECRET;
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  const req = { method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} } };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.message, 'atlas_mcp_auth_not_configured');
});

test('remote MCP returns 401 when auth is configured but bearer is missing', async () => {
  process.env.ATLAS_MCP_SECRET = 'test-secret';
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  const req = { method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} } };
  const res = mockResponse();
  await handler(req, res);
  delete process.env.ATLAS_MCP_SECRET;
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.message, 'missing_bearer');
});

test('dedicated atlas-mcp deploy root points at the generated shared runtime', async () => {
  const mcpSource = readFileSync(new URL('../apps/atlas-mcp/api/mcp.js', import.meta.url), 'utf8');
  const resourceSource = readFileSync(new URL('../apps/atlas-mcp/api/oauth-protected-resource.js', import.meta.url), 'utf8');
  assert.match(mcpSource, /runtime\/api\/mcp\.js/);
  assert.match(resourceSource, /runtime\/api\/oauth-protected-resource\.js/);
  assert.equal(typeof handler, 'function');
  assert.equal(typeof protectedResourceHandler, 'function');
});
