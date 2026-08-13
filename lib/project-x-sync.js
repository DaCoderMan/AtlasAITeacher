import pg from 'pg';

const { Pool } = pg;

const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function normalizeProjectName(name = '') {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[—–-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export async function loadCanonicalProjects() {
  const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 });
  try {
    const { rows } = await pool.query(`
      SELECT id::text, name, objective, status, priority, next_action, blockers,
             external_links, updated_at
      FROM projects
      WHERE user_id = $1 AND deleted_at IS NULL
        AND status = ANY($2::text[])
      ORDER BY priority DESC, name ASC
    `, [process.env.ATLAS_USER_ID || 'default', ['active', 'waiting', 'later']]);

    const seen = new Map();
    for (const row of rows) {
      const key = normalizeProjectName(row.name);
      const existing = seen.get(key);
      if (!existing || new Date(row.updated_at) > new Date(existing.updated_at)) seen.set(key, row);
    }
    return [...seen.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  } finally {
    await pool.end();
  }
}

function richText(content, annotations = {}) {
  return [{ type: 'text', text: { content: String(content).slice(0, 1900) }, annotations }];
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function heading(text, level = 2) {
  const type = `heading_${level}`;
  return { object: 'block', type, [type]: { rich_text: richText(text, { bold: true }) } };
}

function bullet(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(text) } };
}

export function projectBlocks(projects, syncedAt = new Date()) {
  const blocks = [
    {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '🔄' },
        color: 'green_background',
        rich_text: richText(`Neon is canonical. Automatic Project X mirror. Synced ${syncedAt.toISOString()}.`)
      }
    }
  ];

  for (const priority of [...new Set(projects.map(p => p.priority))].sort((a, b) => b - a)) {
    blocks.push(heading(`P${priority}`));
    for (const p of projects.filter(x => x.priority === priority)) {
      blocks.push(heading(`${p.name} — ${p.status}`, 3));
      blocks.push(bullet(`Neon ID: ${p.id}`));
      if (p.objective) blocks.push(bullet(`Objective: ${p.objective}`));
      if (p.next_action) blocks.push(bullet(`Next action: ${p.next_action}`));
      if (p.blockers) blocks.push(bullet(`Blocker: ${p.blockers}`));
    }
  }
  blocks.push(paragraph('Sync rule: update Neon first; this page is a human-readable mirror.'));
  return blocks;
}

async function notion(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${required('NOTION_TOKEN')}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Notion ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function listChildren(blockId) {
  const all = [];
  let cursor;
  do {
    const q = new URLSearchParams({ page_size: '100' });
    if (cursor) q.set('start_cursor', cursor);
    const data = await notion(`/blocks/${blockId}/children?${q}`);
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

async function replaceChildren(pageId, blocks) {
  const existing = await listChildren(pageId);
  for (const block of existing) {
    await notion(`/blocks/${block.id}`, { method: 'DELETE' });
  }
  for (let i = 0; i < blocks.length; i += 100) {
    await notion(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks.slice(i, i + 100) })
    });
  }
}

export async function syncProjectX({ dryRun = false } = {}) {
  const projects = await loadCanonicalProjects();
  const blocks = projectBlocks(projects);
  if (!dryRun) await replaceChildren(required('PROJECT_X_NOTION_PAGE_ID'), blocks);
  return { ok: true, dryRun, projectCount: projects.length, blockCount: blocks.length, projects };
}
