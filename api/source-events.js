import { fromChatGPTMessage, fromWhatsAppMessage, fromGmailMessage, fromFile } from '../lib/adapters.js';
import { enqueueSourceEvent } from '../lib/auto-ingest.js';

function authorized(req) {
  const expected = process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

function adapt(type, item, context) {
  switch (type) {
    case 'chatgpt': return fromChatGPTMessage(item, { ...context, voice: false });
    case 'chatgpt_voice': return fromChatGPTMessage(item, { ...context, voice: true });
    case 'whatsapp': return fromWhatsAppMessage(item, context);
    case 'gmail': return fromGmailMessage(item, context);
    case 'file': return fromFile(item, context);
    default: throw new Error(`unsupported source_type: ${type}`);
  }
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
    const type = body.source_type;
    const items = Array.isArray(body.items) ? body.items : [];
    const context = body.context || {};
    if (!type) return res.status(400).json({ ok: false, error: 'source_type is required' });
    if (!items.length) return res.status(400).json({ ok: false, error: 'items array is required' });
    if (items.length > 500) return res.status(413).json({ ok: false, error: 'maximum 500 items per request' });

    const queued = [];
    for (const item of items) queued.push(await enqueueSourceEvent(adapt(type, item, context)));
    return res.status(202).json({ ok: true, source_type: type, total: queued.length, queued });
  } catch (error) {
    console.error('Atlas source gateway failed', error);
    return res.status(400).json({ ok: false, error: error.message });
  }
}
