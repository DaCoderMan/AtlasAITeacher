import { processQueuedEvents, getAutomationStatus } from '../lib/auto-ingest.js';

const intervalMs = Number(process.env.ATLAS_DAEMON_INTERVAL_MS || 5000);
const batchSize = Number(process.env.ATLAS_DAEMON_BATCH_SIZE || 25);
let stopping = false;

async function tick() {
  try {
    const result = await processQueuedEvents({ limit: batchSize });
    if (result.processed) {
      console.error(`[atlas-daemon] processed=${result.processed}`);
    }
  } catch (error) {
    console.error('[atlas-daemon] worker error', error);
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.error(`[atlas-daemon] ${signal}: stopping`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.error(`[atlas-daemon] started interval=${intervalMs}ms batch=${batchSize}`);
console.error('[atlas-daemon] queue status', await getAutomationStatus());

while (!stopping) {
  await tick();
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}
