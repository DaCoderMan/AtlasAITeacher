import { atlasSave, closeAtlasSavePool } from '../lib/atlas-save.js';

function header(req, name) {
  const headers = req.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function authorized(req) {
  if (process.env.ATLAS_SAVE_ALLOW_UNAUTHENTICATED === 'true') return true;
  const expected = process.env.ATLAS_MCP_SECRET || process.env.ATLAS_SAVE_SECRET;
  if (!expected) return false;
  return (header(req, 'authorization') || '') === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'atlas-save',
      policy: 'atlas.save.policy.v1',
      requiresAuth: process.env.ATLAS_SAVE_ALLOW_UNAUTHENTICATED !== 'true'
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const result = await atlasSave(body);
    const ok = ['SAVED_VERIFIED', 'SAVED_BACKUP_PENDING'].includes(result.status);
    return res.status(ok ? 200 : 500).json({ ok, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'FAILED', error: error?.message || String(error) });
  }
}

export { closeAtlasSavePool };
