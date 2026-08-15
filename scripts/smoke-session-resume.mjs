function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

async function mcpCall(baseUrl, bearer, name, args = {}) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args }
    })
  });
  const body = await response.json();
  if (body.error) {
    const error = new Error(`${name} RPC error: ${JSON.stringify(body.error)}`);
    error.rpc = body.error;
    throw error;
  }
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${JSON.stringify(body)}`);
  const result = body.result || {};
  if (result.isError) throw new Error(`${name} tool error: ${result.content?.[0]?.text || 'unknown'}`);
  return result.structuredContent ?? JSON.parse(result.content?.[0]?.text || '{}');
}

async function main() {
  const baseUrl = process.env.ATLAS_MCP_URL || 'https://atlas-mcp-navy.vercel.app/api/mcp';
  const bearer = required('ATLAS_MCP_BEARER');
  const probeKey = `cx010-smoke-${Date.now()}`;
  const expectedCanonicalVersion = Number(process.env.ATLAS_EXPECTED_CANONICAL_VERSION || 31);

  const initial = await mcpCall(baseUrl, bearer, 'atlas_checkpoint_session', {
    project_key: 'atlas',
    expected_canonical_version: expectedCanonicalVersion,
    context: { probe_key: probeKey, phase: 'initial' },
    delta: { action: 'checkpoint', probe_key: probeKey, step: 1 },
    checkpoint_state: { summary: 'Initial checkpoint for CX-010 smoke verification.' },
    causal_links: [{ type: 'probe', key: probeKey }],
    unfinished_handle: `unfinished:${probeKey}`
  });

  const resumed = await mcpCall(baseUrl, bearer, 'atlas_resume_session', {
    session_id: initial.session_id
  });

  let staleConflict = null;
  try {
    await mcpCall(baseUrl, bearer, 'atlas_checkpoint_session', {
      session_id: initial.session_id,
      expected_session_version: Math.max(0, Number(initial.checkpoint_version) - 1),
      expected_canonical_version: expectedCanonicalVersion,
      context: { probe_key: probeKey, phase: 'stale-conflict' },
      delta: { action: 'checkpoint', probe_key: probeKey, step: 2 },
      checkpoint_state: { summary: 'This write should be rejected as stale.' }
    });
  } catch (error) {
    staleConflict = error.rpc?.message || error.message;
  }

  if (!resumed.latest_checkpoint) throw new Error('resumeSession returned no latest checkpoint');
  if (resumed.latest_checkpoint.checkpoint_id !== initial.checkpoint_id) {
    throw new Error('resumeSession did not return the latest checkpoint');
  }
  if (!staleConflict || !/session_version_conflict/.test(staleConflict)) {
    throw new Error(`expected stale session conflict, got: ${staleConflict || 'none'}`);
  }

  console.log(JSON.stringify({
    session_id: initial.session_id,
    checkpoint_id: initial.checkpoint_id,
    checkpoint_version: initial.checkpoint_version,
    resume_handle: initial.resume_handle,
    unfinished_handle: initial.unfinished_handle,
    resumed_current_version: resumed.current_version,
    resumed_checkpoint_version: resumed.latest_checkpoint.checkpoint_version,
    stale_conflict: staleConflict
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
