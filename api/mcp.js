import { toolDefinitions, dispatchTool } from '../mcp/server.js';
import {
  authenticateMcpRequest,
  oauthEnabled,
  requireScope,
  setOAuthChallenge,
  tunnelUnauthenticatedEnabled
} from '../lib/mcp-auth.js';
import {
  MCP_LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  validateProtocolHeader
} from '../lib/mcp-protocol.js';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function structuredToolContent(toolName, value) {
  if (toolName === 'atlas_projects' && Array.isArray(value)) return { projects: value };
  if (toolName === 'atlas_tasks' && Array.isArray(value)) return { tasks: value };
  if (toolName === 'atlas_manifests' && Array.isArray(value)) return { manifests: value };
  return value && typeof value === 'object' ? value : { value };
}

function toolResult(toolName, value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: structuredToolContent(toolName, value)
  };
}

function isMutationTool(name) {
  const definition = toolDefinitions.find(tool => tool.name === name);
  return Boolean(definition && definition.annotations?.readOnlyHint === false);
}

function remoteReadOnlyEnabled() {
  return process.env.ATLAS_MCP_REMOTE_READ_ONLY === 'true';
}

function exposedToolDefinitions() {
  return remoteReadOnlyEnabled()
    ? toolDefinitions.filter(tool => tool.annotations?.readOnlyHint !== false)
    : toolDefinitions;
}

function authFailure(req, res, auth) {
  if (oauthEnabled()) setOAuthChallenge(req, res, { scope: 'atlas.read', error: 'invalid_token' });
  return res.status(auth?.status || 401).json(rpcError(null, -32001, auth?.reason || 'unauthorized'));
}

function requestProtocol(req) {
  return req.headers?.['mcp-protocol-version'] || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'atlas-mcp',
      transport: 'streamable-http-json',
      version: '2.0.0',
      protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
      oauth: oauthEnabled(),
      legacyBearer: Boolean(process.env.ATLAS_MCP_SECRET),
      tunnelUnauthenticated: tunnelUnauthenticatedEnabled(),
      remoteReadOnly: remoteReadOnlyEnabled(),
      exposedToolCount: exposedToolDefinitions().length
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

  if (!message || message.jsonrpc !== '2.0') return res.status(400).json(rpcError(message?.id, -32600, 'invalid_request'));

  if (message.method === 'initialize') {
    const negotiated = negotiateProtocolVersion(message.params?.protocolVersion);
    res.setHeader('MCP-Protocol-Version', negotiated);
    return res.status(200).json(rpcResult(message.id, {
      protocolVersion: negotiated,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'atlas', title: 'Atlas AI Operating System', version: '2.0.0' },
      instructions: remoteReadOnlyEnabled()
        ? 'Atlas is running in remote read-only mode. Use Atlas for canonical project context, planning, health, search and status; mutation tools are intentionally not exposed.'
        : 'Atlas is the canonical project-aware orchestration, context, persistence, planning, QA and ingestion gateway. OAuth clients should request atlas.read; mutation tools additionally require atlas.write.'
    }));
  }

  const protocol = validateProtocolHeader(requestProtocol(req), { allowMissing: true });
  if (!protocol.ok) {
    return res.status(400).json(rpcError(message.id, -32602, 'Unsupported protocol version', {
      requested: protocol.requested,
      supported: protocol.supported
    }));
  }
  res.setHeader('MCP-Protocol-Version', protocol.version || '2025-03-26');

  if (message.method === 'notifications/initialized') return res.status(204).end();
  if (message.method === 'ping') return res.status(200).json(rpcResult(message.id, {}));

  if (message.method === 'tools/list') {
    if (!requireScope(auth, 'atlas.read') && auth.mode === 'oauth') {
      setOAuthChallenge(req, res, { scope: 'atlas.read', error: 'insufficient_scope' });
      return res.status(403).json(rpcError(message.id, -32003, 'insufficient_scope'));
    }
    return res.status(200).json(rpcResult(message.id, { tools: exposedToolDefinitions() }));
  }

  if (message.method === 'tools/call') {
    const toolName = message.params?.name;
    const definition = toolDefinitions.find(tool => tool.name === toolName);
    if (!definition) return res.status(200).json(rpcError(message.id, -32602, `Unknown tool: ${toolName || ''}`));
    if (remoteReadOnlyEnabled() && definition.annotations?.readOnlyHint === false) {
      return res.status(403).json(rpcError(message.id, -32003, 'remote_read_only'));
    }
    const requiredScope = isMutationTool(toolName) ? 'atlas.write' : 'atlas.read';
    if (auth.mode === 'oauth' && !requireScope(auth, requiredScope)) {
      setOAuthChallenge(req, res, { scope: requiredScope, error: 'insufficient_scope' });
      return res.status(403).json(rpcError(message.id, -32003, 'insufficient_scope'));
    }
    try {
      const value = await dispatchTool(toolName, message.params?.arguments || {});
      return res.status(200).json(rpcResult(message.id, toolResult(toolName, value)));
    } catch (error) {
      return res.status(200).json(rpcResult(message.id, {
        isError: true,
        content: [{ type: 'text', text: error?.message || String(error) }]
      }));
    }
  }

  return res.status(404).json(rpcError(message.id, -32601, `Method not found: ${message.method}`));
}
