import { toolDefinitions, dispatchTool } from '../mcp/server.js';

function authorized(req) {
  if (process.env.ATLAS_MCP_ALLOW_UNAUTHENTICATED === 'true') return true;
  const expected = process.env.ATLAS_MCP_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('MCP-Protocol-Version', '2025-06-18');

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'atlas-mcp',
      transport: 'streamable-http-json',
      version: '1.2.0',
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

  if (message.method === 'notifications/initialized') return res.status(204).end();

  if (message.method === 'ping') return res.status(200).json(rpcResult(message.id, {}));

  if (message.method === 'initialize') {
    return res.status(200).json(rpcResult(message.id, {
      protocolVersion: message.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'atlas', version: '1.2.0' },
      instructions: 'Atlas is the canonical personal context and automatic-ingestion gateway. Use read tools for current state. Mutating tools may be unavailable depending on the ChatGPT plan and app permissions.'
    }));
  }

  if (message.method === 'tools/list') {
    return res.status(200).json(rpcResult(message.id, { tools: toolDefinitions }));
  }

  if (message.method === 'tools/call') {
    try {
      const value = await dispatchTool(message.params?.name, message.params?.arguments || {});
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
