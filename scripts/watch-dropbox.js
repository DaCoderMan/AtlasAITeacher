import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromFile } from '../lib/adapters.js';
import { enqueueSourceEvent } from '../lib/auto-ingest.js';

const root = path.resolve(process.env.ATLAS_DROPBOX_DIR || './atlas-inbox');
const intervalMs = Number(process.env.ATLAS_DROPBOX_INTERVAL_MS || 10000);
const maxTextBytes = Number(process.env.ATLAS_DROPBOX_MAX_TEXT_BYTES || 1048576);
const readable = new Set(['.txt', '.md', '.json', '.csv', '.log', '.html', '.htm', '.xml', '.yaml', '.yml']);

function stableId(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function buildEvent(filePath) {
  const stat = await fs.stat(filePath);
  const relative = path.relative(root, filePath);
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  if (readable.has(ext) && stat.size <= maxTextBytes) {
    text = await fs.readFile(filePath, 'utf8');
  }
  const checksum = stableId(`${relative}|${stat.size}|${stat.mtimeMs}`);
  return fromFile({
    id: checksum,
    name: path.basename(filePath),
    size: stat.size,
    modified_at: stat.mtime.toISOString(),
    mime_type: ext || null,
    checksum,
    text,
    durable_ref: filePath
  }, {
    actor: 'atlas_dropbox',
    imported_via: 'atlas_dropbox_watcher'
  });
}

const seen = new Map();
async function scan() {
  await fs.mkdir(root, { recursive: true });
  for (const filePath of await walk(root)) {
    try {
      const stat = await fs.stat(filePath);
      const signature = `${stat.size}:${stat.mtimeMs}`;
      if (seen.get(filePath) === signature) continue;
      const event = await buildEvent(filePath);
      await enqueueSourceEvent(event);
      seen.set(filePath, signature);
      console.error(`[atlas-dropbox] queued ${path.relative(root, filePath)}`);
    } catch (error) {
      console.error(`[atlas-dropbox] failed ${filePath}: ${error?.message || error}`);
    }
  }
}

console.error(`[atlas-dropbox] watching ${root} every ${intervalMs}ms`);
while (true) {
  await scan();
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}
