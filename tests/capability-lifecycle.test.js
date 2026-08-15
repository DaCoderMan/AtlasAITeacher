import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilitySnapshot, compareCapabilitySnapshot, parseClientCapabilitySnapshot } from '../lib/capability-lifecycle.js';

const TOOLS = [
  { name: 'alpha', description: 'a', inputSchema: { type: 'object', properties: { x: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'beta', description: 'b', inputSchema: { type: 'object', properties: { y: { type: 'number' } } }, annotations: { readOnlyHint: false } }
];

test('capability snapshot is deterministic for the same tool surface', () => {
  const a = capabilitySnapshot(TOOLS, { remoteReadOnly: false, oauth: true });
  const b = capabilitySnapshot([...TOOLS].reverse(), { remoteReadOnly: false, oauth: true });
  assert.equal(a.tool_schema_hash, b.tool_schema_hash);
  assert.equal(a.capability_epoch, b.capability_epoch);
  assert.equal(a.scope_profile, 'atlas.read atlas.write');
});

test('compareCapabilitySnapshot detects added removed changed tools and scope drift', () => {
  const current = capabilitySnapshot(TOOLS, { remoteReadOnly: false, oauth: true });
  const client = {
    capability_epoch: 'old',
    tool_schema_hash: 'old-hash',
    scope_profile: 'atlas.read',
    freeze_tool_schema: true,
    tool_names: ['alpha', 'gamma'],
    tool_hashes: { alpha: 'stale', gamma: 'other' }
  };
  const compared = compareCapabilitySnapshot(current, client);
  assert.equal(compared.stale, true);
  assert.equal(compared.frozen, true);
  assert.deepEqual(compared.added_tools, ['beta']);
  assert.deepEqual(compared.removed_tools, ['gamma']);
  assert.deepEqual(compared.changed_tools, ['alpha']);
  assert.equal(compared.scope_changed, true);
});

test('parseClientCapabilitySnapshot reads headers and params without requiring both', () => {
  const parsed = parseClientCapabilitySnapshot(
    { headers: { 'x-atlas-tool-schema-hash': 'abc', 'x-atlas-freeze-tool-schema': 'true', 'x-atlas-tool-names': 'alpha,beta' } },
    { client_capability_epoch: 'epoch-1', client_scope_profile: 'atlas.read' }
  );
  assert.equal(parsed.capability_epoch, 'epoch-1');
  assert.equal(parsed.tool_schema_hash, 'abc');
  assert.equal(parsed.freeze_tool_schema, true);
  assert.deepEqual(parsed.tool_names, ['alpha', 'beta']);
  assert.equal(parsed.scope_profile, 'atlas.read');
});
