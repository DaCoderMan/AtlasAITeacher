import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mcp.js';
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

async function call(body, headers = {}) {
  const req = { method: 'POST', headers, body };
  const res = mockResponse();
  process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED = 'true';
  await handler(req, res);
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  return res;
}

function modernMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'atlas-test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {}
  };
}

function modernHeaders(method, name) {
  return {
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {})
  };
}

test('legacy remote MCP still initializes for ChatGPT', async () => {
  const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.serverInfo.name, 'atlas');
  assert.equal(res.body.result.protocolVersion, '2025-06-18');
});

test('legacy remote MCP exposes same Atlas tools as Codex MCP', async () => {
  const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.result.tools.map(t => t.name), toolDefinitions.map(t => t.name));
});

test('2026-07-28 server/discover is stateless and self describing', async () => {
  const res = await call(
    { jsonrpc: '2.0', id: 'd1', method: 'server/discover', params: { _meta: modernMeta() } },
    modernHeaders('server/discover')
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.result.supportedVersions.includes('2026-07-28'));
  assert.equal(res.body.result.resultType, 'complete');
  assert.equal(res.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'atlas');
  assert.equal(res.body.result.cacheScope, 'private');
  assert.ok(res.body.result.ttlMs > 0);
});

test('2026-07-28 tools/list is deterministic and cacheable', async () => {
  const body = { jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: modernMeta() } };
  const headers = modernHeaders('tools/list');
  const a = await call(body, headers);
  const b = await call({ ...body, id: 5 }, headers);
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.result.resultType, 'complete');
  assert.equal(a.body.result.cacheScope, 'private');
  assert.ok(a.body.result.ttlMs > 0);
  assert.deepEqual(a.body.result.tools.map(t => t.name), b.body.result.tools.map(t => t.name));
  assert.deepEqual(a.body.result.tools.map(t => t.name), [...toolDefinitions].map(t => t.name).sort());
});

test('2026-07-28 header mismatch fails closed', async () => {
  const res = await call(
    { jsonrpc: '2.0', id: 6, method: 'tools/list', params: { _meta: modernMeta() } },
    modernHeaders('tools/call')
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'HeaderMismatch');
});

test('2026-07-28 tools/call requires matching Mcp-Name', async () => {
  const res = await call(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'atlas_status', arguments: {}, _meta: modernMeta() } },
    modernHeaders('tools/call', 'wrong_name')
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'HeaderMismatch');
});

test('unsupported protocol fails closed with supported versions', async () => {
  const res = await call(
    { jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: { ...modernMeta(), 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } },
    { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'UnsupportedProtocolVersionError');
});

test('remote MCP fails closed when no authentication mode is configured', async () => {
  delete process.env.ATLAS_MCP_SECRET;
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  const req = { method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} } };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
});
