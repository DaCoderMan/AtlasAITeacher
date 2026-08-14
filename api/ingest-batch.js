import { ingestEvent } from '../lib/ingestion.js';

function authorized(req) {
  const expected = process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.ATLAS_INGEST_SECRET) return res.status(503).json({ ok: false, error: 'ingest_secret_not_configured' });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const events = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ ok: false, error: 'events array is required' });
    }
    if (events.length > 500) return res.status(413).json({ ok: false, error: 'maximum 500 events per batch' });

    const results = [];
    for (const event of events) {
      try {
        results.push(await ingestEvent(event));
      } catch (error) {
        results.push({ ok: false, error: error.message, source_event_id: event?.source_event_id || null });
      }
    }

    const failed = results.filter(x => !x.ok).length;
    return res.status(failed ? 207 : 200).json({ ok: failed === 0, total: results.length, failed, results });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
}
