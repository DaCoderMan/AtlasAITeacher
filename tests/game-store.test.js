import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoundInput, persistGameRound } from '../lib/game-store.js';

test('game round validation requires stable event identity and game identity', () => {
  assert.throws(() => validateRoundInput({ round_number: 1 }), /event_id is required/);
  assert.throws(() => validateRoundInput({ event_id: 'e1', round_number: 1 }), /game_id or game_slug is required/);
  const round = validateRoundInput({ event_id: 'e1', game_slug: 'digital-charisma', round_number: 1, xp_delta: 25 });
  assert.equal(round.event_id, 'e1');
  assert.equal(round.game_slug, 'digital-charisma');
  assert.equal(round.xp_delta, 25);
});

function fakeDb({ duplicate = false } = {}) {
  const calls = [];
  let progress = null;
  const game = { id: '11111111-1111-1111-1111-111111111111', slug: 'digital-charisma' };
  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT id::text, slug FROM atlas_games')) return { rows: [game] };
      if (text.startsWith('INSERT INTO atlas_game_rounds')) return { rows: duplicate ? [] : [{ id: 'round-1' }] };
      if (text.startsWith('INSERT INTO atlas_game_progress')) {
        progress = {
          user_id: params[0], game_id: game.id, game_slug: game.slug,
          xp: Math.max(0, Number(params[2] || 0)), mastery_score: params[3] ?? 0,
          transfer_score: params[4] ?? 0, current_level: params[5], current_mission: params[6],
          exact_resume_point: JSON.parse(params[7]), achievements: JSON.parse(params[8]),
          state: JSON.parse(params[9]), last_event_id: params[10], provenance: JSON.parse(params[11])
        };
        return { rows: [] };
      }
      throw new Error(`Unexpected client query: ${text}`);
    },
    release() { calls.push('RELEASE'); }
  };
  return {
    calls,
    connect: async () => client,
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(`POOL:${text}`);
      if (!progress && duplicate) {
        progress = {
          user_id: 'default', game_id: game.id, game_slug: game.slug, xp: 100,
          mastery_score: 0, transfer_score: 0, current_level: null, current_mission: null,
          exact_resume_point: { round: 4 }, achievements: [], state: {}, last_event_id: 'e1', provenance: {}
        };
      }
      return { rows: progress ? [progress] : [] };
    }
  };
}

test('new round performs transaction, aggregate update, commit and readback', async () => {
  const db = fakeDb();
  const result = await persistGameRound({
    event_id: 'evt-1', game_slug: 'digital-charisma', round_number: 2,
    xp_delta: 40, resume_point: { round: 3 }, state: { mission: 'rapport' },
    provenance: { source: 'test' }
  }, { db });
  assert.equal(result.saved, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.progress.xp, 40);
  assert.equal(result.progress.last_event_id, 'evt-1');
  assert.ok(db.calls.includes('BEGIN'));
  assert.ok(db.calls.includes('COMMIT'));
  assert.ok(db.calls.some(x => x.startsWith('POOL:SELECT p.user_id')));
});

test('duplicate event does not update aggregate XP and returns existing readback', async () => {
  const db = fakeDb({ duplicate: true });
  const result = await persistGameRound({
    event_id: 'e1', game_slug: 'digital-charisma', round_number: 4, xp_delta: 40,
    resume_point: { round: 5 }
  }, { db });
  assert.equal(result.saved, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.progress.xp, 100);
  assert.equal(db.calls.some(x => x.startsWith('INSERT INTO atlas_game_progress')), false);
});
