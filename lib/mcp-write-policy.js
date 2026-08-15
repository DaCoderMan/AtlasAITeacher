const SECRET_SENSITIVITY = new Set(['secret']);
const SECRET_BLOCKED_TOOLS = new Set(['atlas_ingest', 'atlas_enqueue', 'atlas_remember']);

export function assertAllowedMcpMutation(toolName, args = {}) {
  const sensitivity = typeof args.sensitivity === 'string' ? args.sensitivity.trim().toLowerCase() : null;
  if (SECRET_BLOCKED_TOOLS.has(toolName) && SECRET_SENSITIVITY.has(sensitivity)) {
    throw new Error('secret_sensitivity_requires_vault');
  }
}
