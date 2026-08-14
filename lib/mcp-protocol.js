export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const MCP_LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
export const MCP_HTTP_MISSING_HEADER_FALLBACK = '2025-03-26';

export function negotiateProtocolVersion(requested) {
  const value = typeof requested === 'string' ? requested.trim() : '';
  return MCP_PROTOCOL_VERSIONS.includes(value) ? value : MCP_LATEST_PROTOCOL_VERSION;
}

export function validateProtocolHeader(value, { allowMissing = true } = {}) {
  if (!value) return allowMissing
    ? { ok: true, version: MCP_HTTP_MISSING_HEADER_FALLBACK, assumed: true }
    : { ok: false, reason: 'missing_protocol_version' };
  const version = String(Array.isArray(value) ? value[0] : value).trim();
  if (!MCP_PROTOCOL_VERSIONS.includes(version)) {
    return { ok: false, reason: 'unsupported_protocol_version', requested: version, supported: [...MCP_PROTOCOL_VERSIONS] };
  }
  return { ok: true, version, assumed: false };
}
