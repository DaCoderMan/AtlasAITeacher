import { readFileSync } from 'node:fs';

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
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${JSON.stringify(body)}`);
  if (body.error) throw new Error(`${name} RPC error: ${JSON.stringify(body.error)}`);
  const result = body.result || {};
  if (result.isError) throw new Error(`${name} tool error: ${result.content?.[0]?.text || 'unknown'}`);
  return result.structuredContent ?? JSON.parse(result.content?.[0]?.text || '{}');
}

function loadRunbook(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main() {
  const baseUrl = process.env.ATLAS_MCP_URL || 'https://atlas-mcp-navy.vercel.app/api/mcp';
  const bearer = required('ATLAS_MCP_BEARER');
  const runbookPath = process.env.ATLAS_RUNBOOK_PATH || 'runbooks/codex-x-execution-order.v1.json';
  const runbook = loadRunbook(runbookPath);

  const started = await mcpCall(baseUrl, bearer, 'atlas_start_execution_run', { runbook });
  const progressBefore = await mcpCall(baseUrl, bearer, 'atlas_report_execution_progress', {
    run_id: started.id
  });
  const claimed = await mcpCall(baseUrl, bearer, 'atlas_claim_next_execution_step', {
    run_id: started.id,
    expected_run_version: started.run_version
  });

  const currentStep = claimed.progress?.current_step;
  if (!currentStep) throw new Error('no current step after claim');

  const progressAfter = await mcpCall(baseUrl, bearer, 'atlas_report_execution_progress', {
    run_id: started.id
  });

  console.log(JSON.stringify({
    run_id: started.id,
    run_key: started.run_key,
    run_revision: started.run_revision,
    progress_before_claim: progressBefore.progress_message,
    claimed_step: currentStep,
    progress_after_claim: progressAfter.progress_message
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
