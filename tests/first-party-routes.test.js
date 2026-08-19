import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFirstPartyRoute, deliverFirstParty } from '../lib/first-party-routes.js';

const payload = {
  route_id: '11111111-1111-1111-1111-111111111111',
  event_id: '22222222-2222-2222-2222-222222222222',
  destination: 'notion',
  action: 'route',
  extraction: { kind: 'task', title: 'Canary title', body: 'Canary body', structured: {} },
  context: { source: 'test', project_hint: 'Atlas' }
};

function clearEnv() {
  for (const key of ['NOTION_TOKEN','ATLAS_NOTION_ROUTE_PARENT_PAGE_ID','GITHUB_TOKEN','ATLAS_GITHUB_ROUTE_REPO']) delete process.env[key];
}

test('first-party routes are disabled unless all destination config exists', () => {
  clearEnv();
  assert.equal(hasFirstPartyRoute('notion'), false);
  assert.equal(hasFirstPartyRoute('github'), false);
  process.env.NOTION_TOKEN = 'x';
  assert.equal(hasFirstPartyRoute('notion'), false);
  process.env.ATLAS_NOTION_ROUTE_PARENT_PAGE_ID = 'parent';
  assert.equal(hasFirstPartyRoute('notion'), true);
  clearEnv();
});

test('Notion adapter creates and reads back the same page', async () => {
  clearEnv();
  process.env.NOTION_TOKEN = 'test-token';
  process.env.ATLAS_NOTION_ROUTE_PARENT_PAGE_ID = 'parent-page';
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.test/page-1', archived: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.test/page-1', archived: false }), { status: 200 });
  };
  try {
    const result = await deliverFirstParty('notion', payload);
    assert.equal(result.destinationRef, 'https://notion.test/page-1');
    assert.equal(result.readback.verified, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /api\.notion\.com\/v1\/pages/);
  } finally {
    global.fetch = originalFetch;
    clearEnv();
  }
});

test('GitHub adapter creates and reads back the same issue', async () => {
  clearEnv();
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.ATLAS_GITHUB_ROUTE_REPO = 'DaCoderMan/atlasupdate';
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') {
      return new Response(JSON.stringify({ number: 42, html_url: 'https://github.test/issues/42' }), { status: 201 });
    }
    return new Response(JSON.stringify({ number: 42, html_url: 'https://github.test/issues/42', state: 'open' }), { status: 200 });
  };
  try {
    const result = await deliverFirstParty('github', { ...payload, destination: 'github' });
    assert.equal(result.destinationRef, 'https://github.test/issues/42');
    assert.equal(result.readback.verified, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /api\.github\.com\/repos\/DaCoderMan\/atlasupdate\/issues/);
  } finally {
    global.fetch = originalFetch;
    clearEnv();
  }
});
