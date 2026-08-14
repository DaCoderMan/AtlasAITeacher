import { toolDefinitions, dispatchTool } from '../mcp/server.js';
import {
  authenticateMcpRequest,
  oauthEnabled,
  requireScope,
  setOAuthChallenge
} from '../lib/mcp-auth.js';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === 'object' ? value : { value }
  };
}

function isMutationTool(name) {
  const definition = toolDefinitions.find(tool => tool.name === name);
  return Boolean(definition && definition.annotations?.readOnlyHint === false);
}

function authFailure(req, res, auth) {
  if (oauthEnabled()) setOAuthChallenge(req, res, { scope: 'atlas.read', error: 'invalid_token' });
  return res.status(auth?.status || 401).json(rpcError(null, -32001, auth?.reason || 'unauthorized'));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('MCP-Protocol-Version', '2025-06-18');

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'atlas-mcp',
      transport: 'streamable-http-json',
      version: '1.3.0',
      oauth: oauthEnabled(),
      legacyBearer: Boolean(process.env.ATLAS_MCP_SECRET),
      tunnelUnauthenticated: process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED === 'true'
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json(rpcError(null, -32600, 'method_not_allowed'));
  }

  const auth = await authenticateMcpRequest(req);
  if (!auth.ok && auth.mode !== 'tunnel') return authFailure(req, res, auth);

  let message;
  try {
    message = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json(rpcError(null, -32700, 'parse_error'));
  }

  if (!message || message.jsonrpc !== '2.0') {
    return res.status(400).json(rpcError(message?.id, -32600, 'invalid_request'));
  }

  if (message.method === 'notifications/initialized') return res.status(204).end();
  if (message.method === 'ping') return res.status(200).json(rpcResult(message.id, {}));

  if (message.method === 'initialize') {
    return res.status(200).json(rpcResult(message.id, {
      protocolVersion: message.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'atlas', version: '1.3.0' },
      instructions: 'Atlas is the canonical personal context and automatic-ingestion gateway. OAuth clients should request atlas.read; mutation tools additionally require atlas.write.'
    }));
  }

  if (message.method === 'tools/list') {
    if (!requireScope(auth, 'atlas.read') && auth.mode === 'oauth') {
      setOAuthChallenge(req, res, { scope: 'atlas.read', error: 'insufficient_scope' });
      return res.status(403).json(rpcError(message.id, -32003, 'insufficient_scope'));
    }
    return res.status(200).json(rpcResult(message.id, { tools: toolDefinitions }));
  }

  if (message.method === 'tools/call') {
    const toolName = message.params?.name;
    const requiredScope = isMutationTool(toolName) ? 'atlas.write' : 'atlas.read';
    if (auth.mode === 'oauth' && !requireScope(auth, requiredScope)) {
      setOAuthChallenge(req, res, { scope: requiredScope, error: 'insufficient_scope' });
      return res.status(403).json(rpcError(message.id, -32003, 'insufficient_scope'));
    }
    try {
      const value = await dispatchTool(toolName, message.params?.arguments || {});
      return res.status(200).json(rpcResult(message.id, toolResult(value)));
    } catch (error) {
      return res.status(200).json(rpcResult(message.id, {
        isError: true,
        content: [{ type: 'text', text: error?.message || String(error) }]
      }));
    }
  }

  return res.status(404).json(rpcError(message.id, -32601, `Method not found: ${message.method}`));
}
