import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReview } from '../lib/learning-engine.js';

const now = new Date('2026-08-16T12:00:00.000Z');

test('good creates a later due date and increments repetitions', () => {
  const next = scheduleReview({ interval_days: 1, repetitions: 1, difficulty: 5, stability_days: 1, lapses: 0 }, 'good', now);
  assert.equal(next.repetitions, 2);
  assert.equal(next.lapses, 0);
  assert.ok(next.interval_days > 1);
  assert.ok(new Date(next.due_at) > now);
});

test('again shortens interval and increments lapses', () => {
  const next = scheduleReview({ interval_days: 10, repetitions: 4, difficulty: 5, stability_days: 10, lapses: 1 }, 'again', now);
  assert.equal(next.repetitions, 5);
  assert.equal(next.lapses, 2);
  assert.ok(next.interval_days < 10);
  assert.ok(next.difficulty > 5);
});

test('easy schedules farther than hard from the same state', () => {
  const state = { interval_days: 5, repetitions: 3, difficulty: 5, stability_days: 5, lapses: 0 };
  const hard = scheduleReview(state, 'hard', now);
  const easy = scheduleReview(state, 'easy', now);
  assert.ok(easy.interval_days > hard.interval_days);
  assert.ok(easy.difficulty < hard.difficulty);
});
