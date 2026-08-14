import { enqueueSourceEvent } from '../lib/auto-ingest.js';

function authorized(req) {
  const expected = process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  const auth = req.headers?.authorization || '';
  return auth === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const events = Array.isArray(body.events) ? body.events : [body];
    const queued = [];
    for (const event of events) queued.push(await enqueueSourceEvent(event));
    return res.status(202).json({ ok: true, queued });
  } catch (error) {
    console.error('Atlas enqueue failed', error);
    return res.status(400).json({ ok: false, error: error.message });
  }
}
