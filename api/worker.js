import { processQueuedEvents, getAutomationStatus } from '../lib/auto-ingest.js';

function authorized(req) {
  const expected = process.env.ATLAS_WORKER_SECRET || process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['POST', 'GET'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.ATLAS_WORKER_SECRET && !process.env.ATLAS_INGEST_SECRET) {
    return res.status(503).json({ ok: false, error: 'worker_secret_not_configured' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    if (req.method === 'GET') {
      const queue = await getAutomationStatus();
      return res.status(200).json({ ok: true, mode: 'status', queue });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 25)));
    const staleMinutes = Math.min(1440, Math.max(1, Number(req.query?.stale_minutes || 10)));
    const result = await processQueuedEvents({ limit, stale_minutes: staleMinutes });
    const queue = await getAutomationStatus();
    return res.status(200).json({ ok: true, mode: 'execute', ...result, queue });
  } catch (error) {
    console.error('Atlas worker failed', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
