import crypto from 'node:crypto';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toolSchemaMaterial(tool) {
  return stableStringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  });
}

export function capabilitySnapshot(tools, { remoteReadOnly = false, oauth = false } = {}) {
  const tool_hashes = Object.fromEntries(
    tools
      .map(tool => [tool.name, hash(toolSchemaMaterial(tool))])
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
  const tool_names = Object.keys(tool_hashes);
  const scope_profile = remoteReadOnly
    ? 'atlas.read'
    : oauth
      ? 'atlas.read atlas.write'
      : 'implicit_or_legacy';
  const tool_schema_hash = hash(stableStringify(tool_hashes));
  return {
    capability_epoch: `2026-08-15.${tool_schema_hash.slice(0, 12)}.${scope_profile.replace(/\s+/g, '_')}`,
    tool_schema_hash,
    scope_profile,
    tool_names,
    tool_hashes
  };
}

export function parseClientCapabilitySnapshot(req, params = {}) {
  const headers = req?.headers || {};
  const readHeader = name => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const freezeHeader = readHeader('x-atlas-freeze-tool-schema');
  const toolNamesHeader = readHeader('x-atlas-tool-names');
  return {
    capability_epoch: params.client_capability_epoch || readHeader('x-atlas-capability-epoch') || null,
    tool_schema_hash: params.client_tool_schema_hash || readHeader('x-atlas-tool-schema-hash') || null,
    scope_profile: params.client_scope_profile || readHeader('x-atlas-scope-profile') || null,
    freeze_tool_schema: params.freeze_tool_schema === true || freezeHeader === 'true',
    tool_names: Array.isArray(params.client_tool_names)
      ? params.client_tool_names
      : typeof toolNamesHeader === 'string' && toolNamesHeader.trim()
        ? toolNamesHeader.split(',').map(value => value.trim()).filter(Boolean)
        : null,
    tool_hashes: params.client_tool_hashes && typeof params.client_tool_hashes === 'object'
      ? params.client_tool_hashes
      : null
  };
}

export function compareCapabilitySnapshot(current, client = {}) {
  const added_tools = Array.isArray(client.tool_names)
    ? current.tool_names.filter(name => !client.tool_names.includes(name))
    : [];
  const removed_tools = Array.isArray(client.tool_names)
    ? client.tool_names.filter(name => !current.tool_names.includes(name))
    : [];
  const changed_tools = client.tool_hashes
    ? Object.keys(client.tool_hashes)
        .filter(name => current.tool_hashes[name] && current.tool_hashes[name] !== client.tool_hashes[name])
        .sort()
    : [];
  const scope_changed = Boolean(client.scope_profile && client.scope_profile !== current.scope_profile);
  const stale = Boolean(
    (client.capability_epoch && client.capability_epoch !== current.capability_epoch)
    || (client.tool_schema_hash && client.tool_schema_hash !== current.tool_schema_hash)
    || scope_changed
    || added_tools.length
    || removed_tools.length
    || changed_tools.length
  );
  return {
    stale,
    frozen: stale && client.freeze_tool_schema === true,
    added_tools,
    removed_tools,
    changed_tools,
    scope_changed,
    current
  };
}
