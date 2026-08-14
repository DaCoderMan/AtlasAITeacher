#!/usr/bin/env node
import { atlasStatus, closeAtlasStorePool } from '../lib/atlas-store.js';

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const status = await atlasStatus();
  if (!status || !Array.isArray(status.top_tasks)) throw new Error('atlas_status returned an unexpected shape');
  console.log(JSON.stringify({ ok: true, projects: status.projects, tasks: status.tasks, routing: status.routing, top_task_count: status.top_tasks.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exitCode = 1;
} finally {
  await closeAtlasStorePool().catch(() => {});
}
