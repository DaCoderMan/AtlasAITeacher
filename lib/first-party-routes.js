const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function titleFor(payload) {
  return String(payload?.extraction?.title || payload?.extraction?.kind || 'Atlas routed item').slice(0, 180);
}

function bodyFor(payload) {
  const body = payload?.extraction?.body || '';
  const structured = payload?.extraction?.structured || {};
  const context = payload?.context || {};
  return [
    body,
    '',
    `Atlas route ID: ${payload?.route_id || ''}`,
    `Atlas event ID: ${payload?.event_id || ''}`,
    `Source: ${context.source || ''}`,
    `Project: ${context.project_hint || ''}`,
    Object.keys(structured).length ? `Structured: ${JSON.stringify(structured)}` : ''
  ].filter(Boolean).join('\n').slice(0, 60000);
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
  const text = await response.text();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function deliverNotion(payload) {
  const parentPageId = required('ATLAS_NOTION_ROUTE_PARENT_PAGE_ID');
  const created = await notion('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      properties: { title: { type: 'title', title: [{ type: 'text', text: { content: titleFor(payload) } }] } },
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: bodyFor(payload).slice(0, 1900) } }] }
      }]
    })
  });
  const readback = await notion(`/pages/${created.id}`);
  const verified = readback?.id === created.id && readback?.archived === false;
  return {
    destinationRef: created.url || created.id,
    response: { id: created.id, url: created.url },
    readback: { verified, payload: { id: readback?.id, url: readback?.url, archived: readback?.archived } }
  };
}

function githubRepo() {
  const repo = required('ATLAS_GITHUB_ROUTE_REPO');
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('ATLAS_GITHUB_ROUTE_REPO must be owner/repo');
  return { owner, name };
}

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${required('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function deliverGitHub(payload) {
  const { owner, name } = githubRepo();
  const created = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: titleFor(payload), body: bodyFor(payload) })
  });
  const readback = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${created.number}`);
  const verified = readback?.number === created.number && readback?.html_url === created.html_url;
  return {
    destinationRef: created.html_url || String(created.number),
    response: { number: created.number, url: created.html_url },
    readback: { verified, payload: { number: readback?.number, url: readback?.html_url, state: readback?.state } }
  };
}

export function hasFirstPartyRoute(destination) {
  if (destination === 'notion') return Boolean(process.env.NOTION_TOKEN && process.env.ATLAS_NOTION_ROUTE_PARENT_PAGE_ID);
  if (destination === 'github') return Boolean(process.env.GITHUB_TOKEN && process.env.ATLAS_GITHUB_ROUTE_REPO);
  return false;
}

export async function deliverFirstParty(destination, payload) {
  if (destination === 'notion') return deliverNotion(payload);
  if (destination === 'github') return deliverGitHub(payload);
  throw new Error(`no first-party adapter for ${destination}`);
}
