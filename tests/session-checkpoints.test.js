import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointSession, resumeSession } from '../lib/control-plane-store.js';

test('session checkpoint exports are available', () => {
  assert.equal(typeof checkpointSession, 'function');
  assert.equal(typeof resumeSession, 'function');
});
