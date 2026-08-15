import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { structuredToolContent } from '../api/mcp.js';
import protectedResourceHandler from '../api/oauth-protected-resource.js';
import { toolDefinitions } from '../mcp/server.js';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

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
  const executionRuns = [{ id: 'r1' }];

  assert.deepEqual(structuredToolContent('atlas_projects', projects), { projects });
  assert.deepEqual(structuredToolContent('atlas_tasks', tasks), { tasks });
  assert.deepEqual(structuredToolContent('atlas_manifests', manifests), { manifests });
  assert.deepEqual(structuredToolContent('atlas_list_execution_runs', executionRuns), { execution_runs: executionRuns });
  assert.deepEqual(structuredToolContent('atlas_manifests', manifests[0]), manifests[0]);
});

async function call(body) {
  const req = { method: 'POST', headers: {}, body };
  const res = mockResponse();
  process.env = { ...process.env, ATLAS_MCP_ALLOW_UNAUTHENTICATED: 'true' };
  await handler(req, res);
  return res;
}

test('remote MCP initializes for ChatGPT', async () => {
  const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.serverInfo.name, 'atlas');
  assert.equal(typeof res.body.result.capabilities.tools.capabilityEpoch, 'string');
  assert.equal(typeof res.body.result.capabilities.tools.toolSchemaHash, 'string');
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

test('remote MCP health does not advertise legacy bearer on public OAuth deployments', async () => {
  process.env.ATLAS_MCP_SECRET = 'legacy-secret';
  process.env.ATLAS_MCP_OAUTH_ISSUER = 'https://auth.example.com';
  process.env.ATLAS_MCP_OAUTH_AUDIENCE = 'https://atlas.example.com/api/mcp';
  process.env.ATLAS_MCP_OAUTH_JWKS_URL = 'https://auth.example.com/jwks';
  process.env.VERCEL = '1';
  const req = { method: 'GET', headers: { host: 'atlas.example.com', 'x-forwarded-proto': 'https' }, body: undefined };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.oauth, true);
  assert.equal(res.body.legacyBearer, false);
  assert.equal(typeof res.body.capabilityEpoch, 'string');
  assert.equal(typeof res.body.toolSchemaHash, 'string');
  assert.equal(res.body.scopeProfile, 'atlas.read atlas.write');
  assert.equal(res.body.releaseGate.status, 'disabled');
});

test('remote MCP reports an open production release gate when evidence is present', async () => {
  process.env.ATLAS_MCP_SECRET = 'legacy-secret';
  process.env.ATLAS_RELEASE_GATE_MODE = 'enforce';
  process.env.ATLAS_RELEASE_GATE_TESTS = 'npm run check && node --test tests/chatgpt-mcp.test.js';
  process.env.ATLAS_RELEASE_GATE_TESTED_AT = '2026-08-15T12:00:00Z';
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
  process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test123';
  const req = { method: 'GET', headers: {}, body: undefined };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.releaseGate.status, 'open');
  assert.equal(res.body.releaseGate.enforced, true);
  assert.equal(res.body.releaseGate.evidence.commit, 'abc123');
  assert.equal(res.body.releaseGate.evidence.deployment, 'dpl_test123');
});

test('remote MCP blocks production POST traffic when enforced release evidence is missing', async () => {
  process.env.ATLAS_RELEASE_GATE_MODE = 'enforce';
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
  delete process.env.VERCEL_DEPLOYMENT_ID;
  delete process.env.ATLAS_RELEASE_GATE_TESTS;
  delete process.env.ATLAS_RELEASE_GATE_TESTED_AT;
  const req = { method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 55, method: 'tools/list', params: {} } };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.message, 'release_gate_blocked');
  assert.deepEqual(res.body.error.data.missing_requirements, ['deployment', 'tests', 'tested_at']);
});

test('remote MCP rejects secret-class durable memory writes before dispatch', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'atlas_remember',
        arguments: { text: 'api key sk-live-...', sensitivity: 'secret' }
      }
    }
  };
  const res = mockResponse();
  process.env = { ...process.env, ATLAS_MCP_ALLOW_UNAUTHENTICATED: 'true' };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.isError, true);
  assert.match(res.body.result.content[0].text, /secret_sensitivity_requires_vault/);
});

test('remote MCP tools/list returns capability snapshot metadata', async () => {
  const res = await call({ jsonrpc: '2.0', id: 40, method: 'tools/list', params: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.result.capability_epoch, 'string');
  assert.equal(typeof res.body.result.tool_schema_hash, 'string');
  assert.equal(res.body.result.scope_profile, 'implicit_or_legacy');
});

test('remote MCP can reject frozen stale client schemas before tool execution', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'atlas_search',
        arguments: { query: 'atlas' },
        client_capability_epoch: 'stale-epoch',
        client_tool_schema_hash: 'stale-hash',
        client_scope_profile: 'atlas.read',
        freeze_tool_schema: true,
        client_tool_names: ['atlas_search']
      }
    }
  };
  const res = mockResponse();
  process.env = { ...process.env, ATLAS_MCP_ALLOW_UNAUTHENTICATED: 'true' };
  await handler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.message, 'stale_client_schema');
});

test('dedicated atlas-mcp deploy root points at the generated shared runtime', async () => {
  const mcpSource = readFileSync(new URL('../apps/atlas-mcp/api/mcp.js', import.meta.url), 'utf8');
  const resourceSource = readFileSync(new URL('../apps/atlas-mcp/api/oauth-protected-resource.js', import.meta.url), 'utf8');
  assert.match(mcpSource, /runtime\/api\/mcp\.js/);
  assert.match(resourceSource, /runtime\/api\/oauth-protected-resource\.js/);
  assert.equal(typeof handler, 'function');
  assert.equal(typeof protectedResourceHandler, 'function');
});
