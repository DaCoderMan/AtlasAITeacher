import { toolDefinitions, dispatchTool } from '../mcp/server.js';

const LEGACY_PROTOCOL = '2025-06-18';
const STATELESS_PROTOCOL = '2026-07-28';
const SERVER_INFO = { name: 'atlas', version: '1.4.0' };
const SERVER_INSTRUCTIONS = 'Atlas is the canonical personal context and automatic-ingestion gateway. Use read tools for current state. Mutating tools may be unavailable depending on the client authorization and Atlas policy.';

function header(req, name) {
  const headers = req.headers || {};
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function authorized(req) {
  if (process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED === 'true') return true;
  const expected = process.env.ATLAS_MCP_SECRET;
  if (!expected) return false;
  return (header(req, 'authorization') || '') === `Bearer ${expected}`;
}

function protocolFrom(req, message) {
  return header(req, 'mcp-protocol-version') ||
    message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ||
    message?.params?.protocolVersion ||
    LEGACY_PROTOCOL;
}

function responseMeta(protocol) {
  if (protocol !== STATELESS_PROTOCOL) return undefined;
  return { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
}

function withModernResultMeta(result, protocol) {
  if (protocol !== STATELESS_PROTOCOL) return result;
  return { ...result, _meta: { ...(result?._meta || {}), ...responseMeta(protocol) } };
}

function rpcResult(id, result, protocol = LEGACY_PROTOCOL) {
  return { jsonrpc: '2.0', id, result: withModernResultMeta(result, protocol) };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function toolResult(value, protocol) {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === 'object' ? value : { value }
  };
  return protocol === STATELESS_PROTOCOL ? { resultType: 'complete', ...result } : result;
}

function stableTools() {
  return [...toolDefinitions].sort((a, b) => a.name.localeCompare(b.name));
}

function validateModernRequest(req, message, protocol) {
  if (protocol !== STATELESS_PROTOCOL) return null;
  const meta = message?.params?._meta;
  if (!meta || meta['io.modelcontextprotocol/protocolVersion'] !== STATELESS_PROTOCOL) {
    return rpcError(message?.id, -32600, 'invalid_request_meta', { expectedProtocolVersion: STATELESS_PROTOCOL });
  }
  if (!meta['io.modelcontextprotocol/clientCapabilities'] || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object') {
    return rpcError(message?.id, -32600, 'invalid_client_capabilities');
  }

  const methodHeader = header(req, 'mcp-method');
  if (!methodHeader || methodHeader !== message.method) {
    return rpcError(message?.id, -32600, 'HeaderMismatch', { header: 'Mcp-Method', expected: message.method, received: methodHeader || null });
  }

  if (message.method === 'tools/call') {
    const expectedName = message.params?.name;
    const nameHeader = header(req, 'mcp-name');
    if (!expectedName || !nameHeader || nameHeader !== expectedName) {
      return rpcError(message?.id, -32600, 'HeaderMismatch', { header: 'Mcp-Name', expected: expectedName || null, received: nameHeader || null });
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    res.setHeader('MCP-Protocol-Version', STATELESS_PROTOCOL);
    return res.status(200).json({
      ok: true,
      service: 'atlas-mcp',
      transport: 'streamable-http-json',
      version: SERVER_INFO.version,
      supportedProtocolVersions: [STATELESS_PROTOCOL, LEGACY_PROTOCOL],
      authenticated: Boolean(process.env.ATLAS_MCP_SECRET) && process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED !== 'true'
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json(rpcError(null, -32600, 'method_not_allowed'));
  }

  if (!process.env.ATLAS_MCP_SECRET && process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED !== 'true') {
    return res.status(503).json(rpcError(null, -32001, 'atlas_mcp_secret_not_configured'));
  }
  if (!authorized(req)) return res.status(401).json(rpcError(null, -32001, 'unauthorized'));

  let message;
  try {
    message = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json(rpcError(null, -32700, 'parse_error'));
  }

  if (!message || message.jsonrpc !== '2.0') {
    return res.status(400).json(rpcError(message?.id, -32600, 'invalid_request'));
  }

  const protocol = protocolFrom(req, message);
  if (![LEGACY_PROTOCOL, STATELESS_PROTOCOL].includes(protocol)) {
    return res.status(400).json(rpcError(message.id, -32002, 'UnsupportedProtocolVersionError', { supportedVersions: [STATELESS_PROTOCOL, LEGACY_PROTOCOL] }));
  }
  res.setHeader('MCP-Protocol-Version', protocol);

  const modernValidationError = validateModernRequest(req, message, protocol);
  if (modernValidationError) return res.status(400).json(modernValidationError);

  if (protocol === LEGACY_PROTOCOL && message.method === 'notifications/initialized') return res.status(204).end();
  if (message.method === 'ping') return res.status(200).json(rpcResult(message.id, protocol === STATELESS_PROTOCOL ? { resultType: 'complete' } : {}, protocol));

  if (protocol === LEGACY_PROTOCOL && message.method === 'initialize') {
    return res.status(200).json(rpcResult(message.id, {
      protocolVersion: LEGACY_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS
    }, protocol));
  }

  if (protocol === STATELESS_PROTOCOL && message.method === 'server/discover') {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(rpcResult(message.id, {
      resultType: 'complete',
      supportedVersions: [STATELESS_PROTOCOL, LEGACY_PROTOCOL],
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: 300000,
      cacheScope: 'private'
    }, protocol));
  }

  if (message.method === 'tools/list') {
    if (protocol === STATELESS_PROTOCOL) res.setHeader('Cache-Control', 'private, max-age=300');
    const result = protocol === STATELESS_PROTOCOL
      ? { resultType: 'complete', tools: stableTools(), ttlMs: 300000, cacheScope: 'private' }
      : { tools: toolDefinitions };
    return res.status(200).json(rpcResult(message.id, result, protocol));
  }

  if (message.method === 'tools/call') {
    try {
      const value = await dispatchTool(message.params?.name, message.params?.arguments || {});
      return res.status(200).json(rpcResult(message.id, toolResult(value, protocol), protocol));
    } catch (error) {
      const result = {
        ...(protocol === STATELESS_PROTOCOL ? { resultType: 'complete' } : {}),
        isError: true,
        content: [{ type: 'text', text: error?.message || String(error) }]
      };
      return res.status(200).json(rpcResult(message.id, result, protocol));
    }
  }

  return res.status(404).json(rpcError(message.id, -32601, `Method not found: ${message.method}`));
}
