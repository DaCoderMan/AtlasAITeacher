#!/usr/bin/env node

const baseUrl = (process.env.ATLAS_API_BASE_URL || '').replace(/\/$/, '');
const token = process.env.ATLAS_CODEX_TOKEN || '';
const workerId = process.env.ATLAS_CODEX_WORKER_ID || `atlas-codex-${process.pid}`;
const pollMs = Number(process.env.ATLAS_CODEX_POLL_MS || 5000);

function usage() {
  console.log(`atlas-codex <command>\n\nCommands:\n  health\n  pull\n  next\n  watch\n  doctor\n  report <job_id>\n  run <job_id>\n`);
}

function requireConfig() {
  const missing = [];
  if (!baseUrl) missing.push('ATLAS_API_BASE_URL');
  if (!token) missing.push('ATLAS_CODEX_TOKEN');
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

async function request(path, options = {}) {
  requireConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-atlas-worker-id': workerId,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Atlas API ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function health() {
  const result = await request('/api/v1/health');
  console.log(JSON.stringify({ worker_id: workerId, atlas: result }, null, 2));
}

async function listJobs() {
  const result = await request('/api/v1/codex/jobs?status=ready,queued,claimed,running,waiting_approval,blocked,review');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function nextJob() {
  const result = await request(`/api/v1/codex/jobs?status=ready&limit=1&worker_id=${encodeURIComponent(workerId)}`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function report(jobId) {
  if (!jobId) throw new Error('job_id is required');
  const result = await request(`/api/v1/codex/jobs/${encodeURIComponent(jobId)}`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function claim(jobId) {
  return request(`/api/v1/codex/jobs/${encodeURIComponent(jobId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({ worker_id: workerId }),
  });
}

async function run(jobId) {
  if (!jobId) throw new Error('job_id is required');
  const claimed = await claim(jobId);
  console.log(JSON.stringify({ claimed }, null, 2));
  console.error('[atlas-codex] Execution wrapper is intentionally gated. Codex invocation will be enabled only after repo allowlist, approval policy, and result contract are implemented and tested.');
  process.exitCode = 2;
}

async function doctor() {
  const checks = {
    node: process.version,
    worker_id: workerId,
    api_base_url_configured: Boolean(baseUrl),
    token_configured: Boolean(token),
    poll_ms: pollMs,
  };
  console.log(JSON.stringify(checks, null, 2));
  if (!baseUrl || !token) process.exitCode = 1;
}

async function watch() {
  requireConfig();
  console.error(`[atlas-codex] watch started worker=${workerId} poll=${pollMs}ms`);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    try {
      await nextJob();
    } catch (error) {
      console.error('[atlas-codex] poll failed', error.body || error.message);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

const [command, arg] = process.argv.slice(2);

try {
  switch (command) {
    case 'health': await health(); break;
    case 'pull': await listJobs(); break;
    case 'next': await nextJob(); break;
    case 'report': await report(arg); break;
    case 'run': await run(arg); break;
    case 'watch': await watch(); break;
    case 'doctor': await doctor(); break;
    default: usage(); process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error('[atlas-codex] error', error.body || error.message || error);
  process.exitCode = 1;
}
