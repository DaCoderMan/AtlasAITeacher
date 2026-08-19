import { persistGameRound } from '../lib/game-store.js';

function authorized(req) {
  const expected = process.env.ATLAS_GAME_SECRET || process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  const auth = req.headers?.authorization || '';
  return auth === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!(process.env.ATLAS_GAME_SECRET || process.env.ATLAS_INGEST_SECRET)) {
    return res.status(503).json({ ok: false, error: 'game_secret_not_configured' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const result = await persistGameRound({ ...body, execution_plane: body.execution_plane || 'atlas_api' });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Atlas game round persistence failed', error);
    return res.status(400).json({ ok: false, saved: false, error: error.message });
  }
}
