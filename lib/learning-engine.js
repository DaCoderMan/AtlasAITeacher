import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

function userId() {
  return process.env.ATLAS_USER_ID || 'default';
}

function clamp(n, min, max) {
  const x = Number(n);
  return Math.max(min, Math.min(max, Number.isFinite(x) ? x : min));
}

export function scheduleReview(state = {}, rating = 'good', now = new Date()) {
  const previousInterval = Math.max(0, Number(state.interval_days || 0));
  const repetitions = Math.max(0, Number(state.repetitions || 0));
  const difficulty = clamp(state.difficulty ?? 5, 1, 10);

  let intervalDays;
  let nextDifficulty = difficulty;
  let lapsesDelta = 0;

  switch (rating) {
    case 'again':
      intervalDays = repetitions === 0 ? 0.01 : Math.max(0.05, previousInterval * 0.18);
      nextDifficulty = clamp(difficulty + 0.8, 1, 10);
      lapsesDelta = 1;
      break;
    case 'hard':
      intervalDays = repetitions === 0 ? 0.5 : Math.max(0.5, previousInterval * 1.45);
      nextDifficulty = clamp(difficulty + 0.25, 1, 10);
      break;
    case 'easy':
      intervalDays = repetitions === 0 ? 4 : Math.max(4, previousInterval * 2.8);
      nextDifficulty = clamp(difficulty - 0.35, 1, 10);
      break;
    case 'good':
    default:
      intervalDays = repetitions === 0 ? 1 : Math.max(1, previousInterval * 2.1);
      nextDifficulty = clamp(difficulty - 0.1, 1, 10);
      break;
  }

  // Harder knowledge receives slightly shorter intervals; this keeps the adapter deterministic
  // until the native FSRS adapter replaces atlas_adaptive_v1.
  const difficultyFactor = 1.15 - ((nextDifficulty - 1) / 9) * 0.3;
  intervalDays = clamp(intervalDays * difficultyFactor, 0.01, 3650);

  const stabilityDays = rating === 'again'
    ? Math.max(0.05, Number(state.stability_days || 0.1) * 0.45)
    : Math.max(intervalDays, Number(state.stability_days || 0) * (rating === 'easy' ? 1.45 : 1.15));

  const due = new Date(now.getTime() + intervalDays * 86400000);
  return {
    scheduler: 'atlas_adaptive_v1',
    scheduler_version: '1',
    interval_days: intervalDays,
    stability_days: stabilityDays,
    difficulty: nextDifficulty,
    repetitions: repetitions + 1,
    lapses: Math.max(0, Number(state.lapses || 0)) + lapsesDelta,
    last_rating: rating,
    last_reviewed_at: now.toISOString(),
    due_at: due.toISOString()
  };
}

export async function createLearningItem({ domain, objective, prompt, canonical_answer, rubric = {}, item_type = 'free_recall', importance = 3, desired_retention = 0.9, provenance = {} } = {}) {
  if (!domain?.trim()) throw new Error('domain is required');
  if (!prompt?.trim()) throw new Error('prompt is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const item = await client.query(`
      INSERT INTO atlas_learning_items(user_id, domain, objective, prompt, canonical_answer, rubric, item_type, importance, desired_retention, provenance)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)
      RETURNING id::text, domain, objective, prompt, canonical_answer, rubric, item_type, importance, desired_retention, provenance, created_at
    `, [userId(), domain.trim(), objective || null, prompt.trim(), canonical_answer || null, JSON.stringify(rubric || {}), item_type, clamp(importance, 1, 5), clamp(desired_retention, 0.7, 0.99), JSON.stringify(provenance || {})]);
    await client.query(`
      INSERT INTO atlas_memory_state(item_id, user_id, due_at)
      VALUES ($1::uuid,$2,now())
      ON CONFLICT (item_id) DO NOTHING
    `, [item.rows[0].id, userId()]);
    await client.query('COMMIT');
    return item.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getDueReviews({ limit = 20, domain } = {}) {
  const params = [userId()];
  let filter = '';
  if (domain?.trim()) {
    params.push(domain.trim());
    filter = ` AND li.domain=$${params.length}`;
  }
  params.push(clamp(limit, 1, 100));
  const { rows } = await pool.query(`
    SELECT li.id::text, li.domain, li.objective, li.prompt, li.item_type, li.importance,
           ms.difficulty, ms.stability_days, ms.interval_days, ms.repetitions, ms.lapses, ms.due_at
    FROM atlas_learning_items li
    JOIN atlas_memory_state ms ON ms.item_id=li.id
    WHERE li.user_id=$1 AND li.deleted_at IS NULL AND ms.due_at <= now()${filter}
    ORDER BY li.importance DESC, ms.due_at ASC
    LIMIT $${params.length}
  `, params);
  return rows;
}

export async function submitReview({ item_id, rating, response_text, correctness, latency_ms, confidence, transfer_score, error_tags = [], grader_model, metadata = {} } = {}) {
  if (!item_id) throw new Error('item_id is required');
  if (!['again','hard','good','easy'].includes(rating)) throw new Error('rating must be again, hard, good, or easy');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query(`
      SELECT * FROM atlas_memory_state WHERE item_id=$1::uuid AND user_id=$2 FOR UPDATE
    `, [item_id, userId()]);
    if (!stateResult.rows.length) throw new Error('learning item not found');
    const next = scheduleReview(stateResult.rows[0], rating, new Date());

    await client.query(`
      INSERT INTO atlas_review_events(user_id,item_id,rating,response_text,correctness,latency_ms,confidence,transfer_score,error_tags,grader_model,metadata)
      VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
    `, [userId(), item_id, rating, response_text || null, correctness == null ? null : clamp(correctness, 0, 1), latency_ms == null ? null : Math.max(0, Number(latency_ms)), confidence == null ? null : clamp(confidence, 0, 100), transfer_score == null ? null : clamp(transfer_score, 0, 1), JSON.stringify(error_tags || []), grader_model || null, JSON.stringify(metadata || {})]);

    await client.query(`
      UPDATE atlas_memory_state SET
        scheduler=$3, scheduler_version=$4, difficulty=$5, stability_days=$6,
        interval_days=$7, repetitions=$8, lapses=$9, last_rating=$10,
        last_reviewed_at=$11::timestamptz, due_at=$12::timestamptz, updated_at=now()
      WHERE item_id=$1::uuid AND user_id=$2
    `, [item_id, userId(), next.scheduler, next.scheduler_version, next.difficulty, next.stability_days, next.interval_days, next.repetitions, next.lapses, next.last_rating, next.last_reviewed_at, next.due_at]);

    await client.query('COMMIT');
    return { item_id, ...next };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getLearningMetrics({ domain } = {}) {
  const params = [userId()];
  let filter = '';
  if (domain?.trim()) { params.push(domain.trim()); filter = ` AND li.domain=$${params.length}`; }
  const { rows } = await pool.query(`
    SELECT
      count(*)::int AS reviews,
      round(avg(re.correctness)::numeric,3) AS mean_correctness,
      round(avg(re.confidence)::numeric,1) AS mean_confidence,
      round(avg(re.transfer_score)::numeric,3) AS mean_transfer,
      count(*) FILTER (WHERE re.correctness < 0.5 AND re.confidence >= 80)::int AS false_confidence_count,
      round(avg(re.latency_ms)::numeric,0) AS mean_latency_ms
    FROM atlas_review_events re
    JOIN atlas_learning_items li ON li.id=re.item_id
    WHERE re.user_id=$1${filter}
  `, params);
  return rows[0];
}

export async function closeLearningPool() {
  await pool.end();
}
