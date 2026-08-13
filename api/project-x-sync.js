import { syncProjectX } from '../lib/project-x-sync.js';

function authorized(req) {
  const secret = process.env.PROJECT_X_SYNC_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${secret}` || req.headers['x-project-x-sync-secret'] === secret;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const result = await syncProjectX({ dryRun });
    return res.status(200).json(result);
  } catch (error) {
    console.error('project-x-sync failed', error);
    return res.status(500).json({ error: 'project_x_sync_failed', message: error.message });
  }
}
