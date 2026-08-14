import { reconcileAtlas } from '../lib/reconciliation.js';

function authorized(req) {
  const expected = process.env.ATLAS_WORKER_SECRET || process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const staleSourceMinutes = Math.max(5, Number(req.query?.staleSourceMinutes || 180));
    const result = await reconcileAtlas({ staleSourceMinutes });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Atlas reconciliation failed', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
