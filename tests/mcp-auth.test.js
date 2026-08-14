import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  authenticateMcpRequest,
  protectedResourceMetadata,
  requireScope,
  setOAuthChallenge
} from '../lib/mcp-auth.js';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

function req(auth = null) {
  return { headers: { host: 'atlas.example.com', 'x-forwarded-proto': 'https', ...(auth ? { authorization: auth } : {}) } };
}

function res() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(privateKey, payload, kid = 'k1') {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

test('protected resource metadata advertises Atlas resource and issuer', () => {
  process.env.ATLAS_MCP_OAUTH_ISSUER = 'https://auth.example.com';
  process.env.ATLAS_MCP_OAUTH_AUDIENCE = 'https://atlas.example.com/api/mcp';
  process.env.ATLAS_MCP_OAUTH_JWKS_URL = 'https://auth.example.com/jwks';
  const metadata = protectedResourceMetadata(req());
  assert.equal(metadata.resource, 'https://atlas.example.com/api/mcp');
  assert.deepEqual(metadata.authorization_servers, ['https://auth.example.com']);
  assert.deepEqual(metadata.scopes_supported, ['atlas.read', 'atlas.write']);
});

test('protected resource metadata can advertise an explicit authorization server identifier', () => {
  process.env.ATLAS_MCP_OAUTH_ISSUER = 'https://tenant.example.us.auth0.com/';
  process.env.ATLAS_MCP_OAUTH_AUTHORIZATION_SERVER = 'https://login.example.com/';
  const metadata = protectedResourceMetadata(req());
  assert.deepEqual(metadata.authorization_servers, ['https://login.example.com/']);
});

test('OAuth challenge points clients to protected-resource metadata', () => {
  const response = res();
  setOAuthChallenge(req(), response, { scope: 'atlas.read' });
  assert.match(response.headers['WWW-Authenticate'], /resource_metadata="https:\/\/atlas\.example\.com\/\.well-known\/oauth-protected-resource"/);
  assert.match(response.headers['WWW-Authenticate'], /scope="atlas\.read"/);
});

test('legacy Atlas secret remains valid', async () => {
  process.env.ATLAS_MCP_SECRET = 'legacy-secret';
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;
  delete process.env.ATLAS_MCP_OAUTH_ISSUER;
  const auth = await authenticateMcpRequest(req('Bearer legacy-secret'));
  assert.equal(auth.ok, true);
  assert.equal(auth.mode, 'legacy-secret');
});

test('OAuth JWT validates issuer, audience, signature, expiration and scopes', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'k1';
  jwk.alg = 'RS256';
  const now = Math.floor(Date.now() / 1000);

  process.env.ATLAS_MCP_OAUTH_ISSUER = 'https://auth.example.com';
  process.env.ATLAS_MCP_OAUTH_AUDIENCE = 'https://atlas.example.com/api/mcp';
  process.env.ATLAS_MCP_OAUTH_JWKS_URL = 'https://auth.example.com/jwks';
  delete process.env.ATLAS_MCP_SECRET;
  delete process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED;

  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { keys: [jwk] }; } });
  try {
    const token = signJwt(privateKey, {
      iss: 'https://auth.example.com',
      aud: 'https://atlas.example.com/api/mcp',
      sub: 'user-1',
      exp: now + 300,
      scope: 'atlas.read offline_access'
    });
    const auth = await authenticateMcpRequest(req(`Bearer ${token}`));
    assert.equal(auth.ok, true);
    assert.equal(auth.mode, 'oauth');
    assert.equal(auth.subject, 'user-1');
    assert.equal(requireScope(auth, 'atlas.read'), true);
    assert.equal(requireScope(auth, 'atlas.write'), false);
  } finally {
    global.fetch = previousFetch;
  }
});
