import test from 'node:test';
import assert from 'node:assert/strict';
import { fromChatGPTMessage, fromWhatsAppMessage, fromGmailMessage, fromFile } from '../lib/adapters.js';

test('ChatGPT voice adapter marks transcript source correctly', () => {
  const event = fromChatGPTMessage({ id: 'm1', role: 'user', text: 'test voice' }, { conversation_id: 'c1', voice: true });
  assert.equal(event.source, 'chatgpt_voice');
  assert.equal(event.content_type, 'voice_transcript');
  assert.equal(event.thread_id, 'c1');
});

test('WhatsApp adapter preserves chat provenance', () => {
  const event = fromWhatsAppMessage({ id: 'w1', from: '9725', text: { body: 'hello' } }, { chat_id: 'chat1' });
  assert.equal(event.source, 'whatsapp');
  assert.equal(event.thread_id, 'chat1');
  assert.equal(event.content_text, 'hello');
});

test('Gmail adapter preserves subject metadata', () => {
  const event = fromGmailMessage({ id: 'g1', threadId: 't1', subject: 'Subject', from: 'a@example.com', text: 'mail body' });
  assert.equal(event.source, 'gmail');
  assert.equal(event.content_json.subject, 'Subject');
});

test('file adapter creates stable metadata event', () => {
  const event = fromFile({ name: 'notes.md', size: 10, modified_at: '2026-08-14T00:00:00Z', text: 'notes' });
  assert.equal(event.source, 'file');
  assert.equal(event.content_json.name, 'notes.md');
  assert.ok(event.source_event_id);
});
