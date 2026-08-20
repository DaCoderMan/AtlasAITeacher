#!/usr/bin/env node
import { atlasSave, closeAtlasSavePool } from '../lib/atlas-save.js';
import { closeAutoIngestPool } from '../lib/auto-ingest.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2).replaceAll('-', '_');
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[name] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.text) {
  console.error('Usage: npm run save:atlas -- --text "conversation text" [--thread-id id] [--source-event-id id]');
  process.exitCode = 2;
} else {
  try {
    const result = await atlasSave({ ...args, source: args.source || 'cli', actor: args.actor || 'user' });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!['SAVED_VERIFIED', 'SAVED_BACKUP_PENDING'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([closeAtlasSavePool(), closeAutoIngestPool()]);
  }
}
