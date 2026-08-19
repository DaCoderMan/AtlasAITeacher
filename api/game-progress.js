import { getGameProgress } from '../lib/game-store.js';

function authorized(req) {
  const expected = process.env.ATLAS_GAME_SECRET || process.env.ATLAS_INGEST_SECRET;
  if (!expected) return false;
  const auth = req.headers?.authorization || '';
  return auth === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!(process.env.ATLAS_GAME_SECRET || process.env.ATLAS_INGEST_SECRET)) {
    return res.status(503).json({ ok: false, error: 'game_secret_not_configured' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const progress = await getGameProgress({
      user_id: req.query?.user_id,
      game_id: req.query?.game_id,
      game_slug: req.query?.game_slug
    });
    if (!progress) return res.status(404).json({ ok: false, error: 'progress_not_found' });
    return res.status(200).json({ ok: true, progress });
  } catch (error) {
    console.error('Atlas game progress read failed', error);
    return res.status(400).json({ ok: false, error: error.message });
  }
}
