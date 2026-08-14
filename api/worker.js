import { processQueuedEvents, getAutomationStatus } from '../lib/auto-ingest.js';

function authorized(req) {
  const expected = process.env.ATLAS_WORKER_SECRET || process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  const auth = req.headers?.authorization || '';
  return auth === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 25)));
    const result = await processQueuedEvents({ limit });
    const queue = await getAutomationStatus();
    return res.status(200).json({ ok: true, ...result, queue });
  } catch (error) {
    console.error('Atlas worker failed', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
