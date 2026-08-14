import crypto from 'node:crypto';

function env(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function base64urlDecode(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_token_format');
  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new Error('invalid_token_encoding');
  }
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: base64urlDecode(parts[2]) };
}

function getBearer(req) {
  const auth = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : null;
}

function normalizeScopes(payload) {
  const raw = payload.scope ?? payload.scp ?? [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

function audienceMatches(payloadAud, expected) {
  if (!expected) return true;
  if (Array.isArray(payloadAud)) return payloadAud.includes(expected);
  return payloadAud === expected;
}

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function publicHostedRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

export function tunnelUnauthenticatedEnabled() {
  return process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED === 'true' && !publicHostedRuntime();
}

let jwksCache = { url: null, expiresAt: 0, keys: [] };

async function loadJwks(url) {
  const now = Date.now();
  if (jwksCache.url === url && jwksCache.expiresAt > now) return jwksCache.keys;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('jwks_fetch_failed');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('jwks_invalid');
  jwksCache = { url, expiresAt: now + 5 * 60_000, keys: body.keys };
  return body.keys;
}

async function verifyJwt(token) {
  const issuer = env('ATLAS_MCP_OAUTH_ISSUER');
  const audience = env('ATLAS_MCP_OAUTH_AUDIENCE');
  const jwksUrl = env('ATLAS_MCP_OAUTH_JWKS_URL');
  if (!issuer || !audience || !jwksUrl) throw new Error('oauth_not_configured');

  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256') throw new Error('unsupported_token_alg');
  if (!parsed.header.kid) throw new Error('missing_token_kid');

  const keys = await loadJwks(jwksUrl);
  const jwk = keys.find(key => key.kid === parsed.header.kid && (!key.alg || key.alg === 'RS256'));
  if (!jwk) throw new Error('signing_key_not_found');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify('RSA-SHA256', Buffer.from(parsed.signingInput), publicKey, parsed.signature);
  if (!validSignature) throw new Error('invalid_token_signature');

  const now = Math.floor(Date.now() / 1000);
  if (parsed.payload.iss !== issuer) throw new Error('invalid_token_issuer');
  if (!audienceMatches(parsed.payload.aud, audience)) throw new Error('invalid_token_audience');
  if (typeof parsed.payload.exp !== 'number' || parsed.payload.exp <= now) throw new Error('token_expired');
  if (typeof parsed.payload.nbf === 'number' && parsed.payload.nbf > now + 30) throw new Error('token_not_yet_valid');

  return { payload: parsed.payload, scopes: normalizeScopes(parsed.payload) };
}

export function oauthEnabled() {
  return Boolean(env('ATLAS_MCP_OAUTH_ISSUER') && env('ATLAS_MCP_OAUTH_AUDIENCE') && env('ATLAS_MCP_OAUTH_JWKS_URL'));
}

export function anyMcpAuthModeEnabled() {
  return tunnelUnauthenticatedEnabled() || Boolean(env('ATLAS_MCP_SECRET')) || oauthEnabled();
}

export function resourceUrl(req) {
  return env('ATLAS_MCP_RESOURCE_URL') || `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host}/api/mcp`;
}

export function resourceMetadataUrl(req) {
  return env('ATLAS_MCP_RESOURCE_METADATA_URL') || `${new URL(resourceUrl(req)).origin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata(req) {
  const authorizationServer = env('ATLAS_MCP_OAUTH_AUTHORIZATION_SERVER') || env('ATLAS_MCP_OAUTH_ISSUER');
  return {
    resource: resourceUrl(req),
    authorization_servers: authorizationServer ? [authorizationServer] : [],
    scopes_supported: ['atlas.read', 'atlas.write']
  };
}

export function setOAuthChallenge(req, res, { scope = 'atlas.read', error = null } = {}) {
  const parts = [`Bearer resource_metadata=\"${resourceMetadataUrl(req)}\"`, `scope=\"${scope}\"`];
  if (error) parts.push(`error=\"${error}\"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
}

export async function authenticateMcpRequest(req) {
  if (tunnelUnauthenticatedEnabled()) {
    return { ok: true, mode: 'tunnel', subject: 'tunnel', scopes: ['atlas.read', 'atlas.write'] };
  }

  if (!anyMcpAuthModeEnabled()) {
    const unsafePublicTunnel = process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED === 'true' && publicHostedRuntime();
    return {
      ok: false,
      status: 503,
      reason: unsafePublicTunnel ? 'atlas_mcp_public_unauthenticated_forbidden' : 'atlas_mcp_auth_not_configured'
    };
  }

  const token = getBearer(req);
  if (!token) return { ok: false, status: 401, reason: 'missing_bearer' };

  const legacy = env('ATLAS_MCP_SECRET');
  if (legacy && timingSafeEqualText(token, legacy)) {
    return { ok: true, mode: 'legacy-secret', subject: 'legacy', scopes: ['atlas.read', 'atlas.write'] };
  }

  if (!oauthEnabled()) return { ok: false, status: 401, reason: 'invalid_bearer' };

  try {
    const { payload, scopes } = await verifyJwt(token);
    return {
      ok: true,
      mode: 'oauth',
      subject: payload.sub || null,
      clientId: payload.client_id || payload.azp || null,
      scopes,
      claims: payload
    };
  } catch (error) {
    return { ok: false, status: 401, reason: error?.message || 'invalid_token' };
  }
}

export function requireScope(auth, scope) {
  return Boolean(auth?.scopes?.includes(scope));
}
