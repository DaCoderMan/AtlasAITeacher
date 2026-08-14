import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const SERVICES = [
  { id: 'neon', category: 'canonical_state', configured: () => Boolean(process.env.DATABASE_URL), capabilities: ['projects', 'tasks', 'memory', 'ingestion', 'audit'] },
  { id: 'notion', category: 'knowledge_mirror', configured: () => Boolean(process.env.NOTION_TOKEN || process.env.ATLAS_ROUTE_NOTION_URL), probe: 'ATLAS_HEALTH_NOTION_URL', capabilities: ['mirror', 'documentation'] },
  { id: 'drive', category: 'files', configured: () => Boolean(process.env.ATLAS_ROUTE_DRIVE_URL), probe: 'ATLAS_HEALTH_DRIVE_URL', capabilities: ['files', 'artifacts', 'backup'] },
  { id: 'github', category: 'engineering', configured: () => Boolean(process.env.ATLAS_ROUTE_GITHUB_URL), probe: 'ATLAS_HEALTH_GITHUB_URL', capabilities: ['source', 'issues', 'pull_requests'] },
  { id: 'calendar', category: 'commitments', configured: () => Boolean(process.env.ATLAS_ROUTE_CALENDAR_URL), probe: 'ATLAS_HEALTH_CALENDAR_URL', capabilities: ['schedule', 'commitments'] },
  { id: 'gmail', category: 'communications', configured: () => Boolean(process.env.ATLAS_ROUTE_GMAIL_URL), probe: 'ATLAS_HEALTH_GMAIL_URL', capabilities: ['email'] },
  { id: 'chatgpt_memory', category: 'memory_mirror', configured: () => Boolean(process.env.ATLAS_ROUTE_MEMORY_URL), probe: 'ATLAS_HEALTH_MEMORY_URL', capabilities: ['memory_candidate'] },
  { id: 'voice', category: 'voice', configured: () => Boolean(process.env.ATLAS_HEALTH_VOICE_URL), probe: 'ATLAS_HEALTH_VOICE_URL', capabilities: ['stt', 'tts'] }
];

function record(service, health, extras = {}) {
  return {
    service_id: service.id,
    category: service.category,
    health,
    configured: service.configured(),
    last_checked: new Date().toISOString(),
    latency_ms: extras.latency_ms ?? null,
    failure_summary: extras.failure_summary ?? null,
    capabilities: [...service.capabilities]
  };
}

async function probeHttp(service, url, timeoutMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (process.env.ATLAS_HEALTH_SECRET) headers.authorization = `Bearer ${process.env.ATLAS_HEALTH_SECRET}`;
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const latency_ms = Date.now() - started;
    if (!response.ok) return record(service, 'degraded', { latency_ms, failure_summary: `health probe returned ${response.status}` });
    return record(service, 'healthy', { latency_ms });
  } catch (error) {
    return record(service, 'degraded', { latency_ms: Date.now() - started, failure_summary: String(error?.message || error) });
  } finally {
    clearTimeout(timer);
  }
}

async function checkNeon(service, timeoutMs) {
  if (!service.configured()) return record(service, 'offline', { failure_summary: 'DATABASE_URL is not configured' });
  const started = Date.now();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Neon health check timed out')), timeoutMs));
  try {
    await Promise.race([pool.query('SELECT 1 AS ok'), timeout]);
    return record(service, 'healthy', { latency_ms: Date.now() - started });
  } catch (error) {
    return record(service, 'degraded', { latency_ms: Date.now() - started, failure_summary: String(error?.message || error) });
  }
}

export async function checkSystemHealth({ timeout_ms = 3000 } = {}) {
  const timeoutMs = Math.max(250, Math.min(10000, Number(timeout_ms) || 3000));
  const checks = SERVICES.map(async service => {
    if (service.id === 'neon') return checkNeon(service, timeoutMs);
    if (!service.configured()) return record(service, 'offline', { failure_summary: 'service is not configured' });
    const url = service.probe ? process.env[service.probe] : null;
    if (!url) return record(service, 'unknown', { failure_summary: 'configured but no live health probe is configured' });
    return probeHttp(service, url, timeoutMs);
  });
  const services = await Promise.all(checks);
  const counts = { healthy: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const service of services) counts[service.health] += 1;
  const overall = counts.degraded ? 'degraded'
    : counts.healthy && !counts.offline && !counts.unknown ? 'healthy'
      : counts.healthy ? 'partial'
        : 'offline';
  return { overall, counts, services };
}

export function listHealthServices() {
  return SERVICES.map(service => ({ service_id: service.id, category: service.category, capabilities: [...service.capabilities] }));
}

export async function closeSystemHealthPool() {
  await pool.end();
}
