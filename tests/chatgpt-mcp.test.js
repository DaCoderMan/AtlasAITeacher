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

test('remote MCP exposes same Atlas tools as Codex MCP', async () => {
  const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.result.tools.map(t => t.name), toolDefinitions.map(t => t.name));
});

test('remote MCP fails closed when no authentication mode is configured', async () => {
  delete process.env.ATLAS_MCP_SECRET;
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  const req = { method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} } };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
});
