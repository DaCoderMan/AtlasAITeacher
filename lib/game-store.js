import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

function defaultUserId() {
  return process.env.ATLAS_USER_ID || 'default';
}

function asInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asScore(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export function validateRoundInput(input = {}) {
  const errors = [];
  if (!input.event_id?.trim()) errors.push('event_id is required');
  if (!input.game_id && !input.game_slug?.trim()) errors.push('game_id or game_slug is required');
  if (!Number.isInteger(Number(input.round_number)) || Number(input.round_number) < 0) errors.push('round_number must be a non-negative integer');
  if (errors.length) throw new Error(errors.join('; '));
  return {
    user_id: input.user_id?.trim() || defaultUserId(),
    event_id: input.event_id.trim(),
    game_id: input.game_id || null,
    game_slug: input.game_slug?.trim() || null,
    session_id: input.session_id || null,
    round_number: asInt(input.round_number),
    challenge_key: input.challenge_key || null,
    prompt_snapshot: input.prompt_snapshot || {},
    response_snapshot: input.response_snapshot || {},
    result: input.result || {},
    xp_delta: asInt(input.xp_delta),
    mastery_delta: input.mastery_delta == null ? null : Number(input.mastery_delta),
    mastery_score: asScore(input.mastery_score),
    transfer_score: asScore(input.transfer_score),
    confidence: input.confidence == null ? null : Math.max(0, Math.min(100, asInt(input.confidence))),
    error_tags: Array.isArray(input.error_tags) ? input.error_tags : [],
    resume_point: input.resume_point || {},
    current_level: input.current_level || null,
    current_mission: input.current_mission || null,
    state: input.state || {},
    achievements: Array.isArray(input.achievements) ? input.achievements : [],
    execution_plane: input.execution_plane || 'atlas_runtime',
    provenance: input.provenance || {}
  };
}

async function resolveGame(client, round) {
  if (round.game_id) {
    const result = await client.query('SELECT id::text, slug FROM atlas_games WHERE id=$1::uuid AND archived_at IS NULL', [round.game_id]);
    if (!result.rows.length) throw new Error('game not found');
    return result.rows[0];
  }
  const result = await client.query('SELECT id::text, slug FROM atlas_games WHERE slug=$1 AND archived_at IS NULL', [round.game_slug]);
  if (!result.rows.length) throw new Error('game not found');
  return result.rows[0];
}

export async function persistGameRound(input = {}, { db = pool } = {}) {
  const round = validateRoundInput(input);
  const client = await db.connect();
  let game;
  let duplicate = false;
  try {
    await client.query('BEGIN');
    game = await resolveGame(client, round);

    const inserted = await client.query(`
      INSERT INTO atlas_game_rounds(
        user_id, game_id, session_id, round_number, challenge_key,
        prompt_snapshot, response_snapshot, result, xp_delta, mastery_delta,
        transfer_score, confidence, error_tags, resume_point, event_id,
        execution_plane, provenance
      ) VALUES (
        $1,$2::uuid,NULLIF($3,'')::uuid,$4,$5,
        $6::jsonb,$7::jsonb,$8::jsonb,$9,$10,
        $11,$12,$13::jsonb,$14::jsonb,$15,$16,$17::jsonb
      )
      ON CONFLICT (user_id, game_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
      RETURNING id::text
    `, [
      round.user_id, game.id, round.session_id || '', round.round_number, round.challenge_key,
      JSON.stringify(round.prompt_snapshot), JSON.stringify(round.response_snapshot), JSON.stringify(round.result), round.xp_delta, round.mastery_delta,
      round.transfer_score, round.confidence, JSON.stringify(round.error_tags), JSON.stringify(round.resume_point), round.event_id,
      round.execution_plane, JSON.stringify(round.provenance)
    ]);

    duplicate = inserted.rows.length === 0;
    if (!duplicate) {
      await client.query(`
        INSERT INTO atlas_game_progress(
          user_id, game_id, xp, mastery_score, transfer_score, current_level,
          current_mission, exact_resume_point, achievements, state, last_played_at,
          last_event_id, provenance, updated_at
        ) VALUES (
          $1,$2::uuid,GREATEST(0,$3),COALESCE($4,0),COALESCE($5,0),$6,$7,
          $8::jsonb,$9::jsonb,$10::jsonb,now(),$11,$12::jsonb,now()
        )
        ON CONFLICT (user_id, game_id) DO UPDATE SET
          xp=GREATEST(0, atlas_game_progress.xp + EXCLUDED.xp),
          mastery_score=COALESCE($4, atlas_game_progress.mastery_score),
          transfer_score=COALESCE($5, atlas_game_progress.transfer_score),
          current_level=COALESCE(EXCLUDED.current_level, atlas_game_progress.current_level),
          current_mission=COALESCE(EXCLUDED.current_mission, atlas_game_progress.current_mission),
          exact_resume_point=EXCLUDED.exact_resume_point,
          achievements=CASE WHEN jsonb_array_length(EXCLUDED.achievements) > 0 THEN EXCLUDED.achievements ELSE atlas_game_progress.achievements END,
          state=atlas_game_progress.state || EXCLUDED.state,
          last_played_at=now(),
          last_event_id=EXCLUDED.last_event_id,
          provenance=atlas_game_progress.provenance || EXCLUDED.provenance,
          updated_at=now()
      `, [
        round.user_id, game.id, round.xp_delta, round.mastery_score, round.transfer_score,
        round.current_level, round.current_mission, JSON.stringify(round.resume_point), JSON.stringify(round.achievements),
        JSON.stringify(round.state), round.event_id, JSON.stringify(round.provenance)
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }

  const readback = await db.query(`
    SELECT p.user_id, p.game_id::text, g.slug AS game_slug, p.xp, p.mastery_score,
           p.transfer_score, p.current_level, p.current_mission, p.exact_resume_point,
           p.achievements, p.state, p.last_event_id, p.provenance, p.last_played_at, p.updated_at
    FROM atlas_game_progress p
    JOIN atlas_games g ON g.id=p.game_id
    WHERE p.user_id=$1 AND p.game_id=$2::uuid
  `, [round.user_id, game.id]);
  if (!readback.rows.length) throw new Error('game progress readback failed after commit');

  return { saved: true, duplicate, event_id: round.event_id, progress: readback.rows[0] };
}

export async function getGameProgress({ user_id, game_id, game_slug } = {}, { db = pool } = {}) {
  const uid = user_id?.trim() || defaultUserId();
  if (!game_id && !game_slug?.trim()) throw new Error('game_id or game_slug is required');
  const params = [uid, game_id || null, game_slug?.trim() || null];
  const { rows } = await db.query(`
    SELECT p.user_id, p.game_id::text, g.slug AS game_slug, g.title, p.xp,
           p.mastery_score, p.transfer_score, p.current_level, p.current_mission,
           p.exact_resume_point, p.achievements, p.state, p.last_event_id,
           p.provenance, p.last_played_at, p.updated_at
    FROM atlas_game_progress p
    JOIN atlas_games g ON g.id=p.game_id
    WHERE p.user_id=$1
      AND (($2::uuid IS NOT NULL AND p.game_id=$2::uuid) OR ($2::uuid IS NULL AND g.slug=$3))
    LIMIT 1
  `, params);
  return rows[0] || null;
}

export async function closeGameStorePool() {
  await pool.end();
}
