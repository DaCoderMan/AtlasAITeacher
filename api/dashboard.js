import { getAtlasDashboard } from '../lib/dashboard.js';

function authorized(req) {
  const expected = process.env.ATLAS_DASHBOARD_SECRET || process.env.ATLAS_MCP_SECRET;
  if (!expected) return false;
  return (req.headers?.authorization || '') === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const dashboard = await getAtlasDashboard({
      now: req.query?.now || new Date().toISOString(),
      active_project_id: req.query?.active_project_id || null
    });
    return res.status(200).json({ ok: true, dashboard });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
