import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

function hashContent(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function normalizeText(value = '') {
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function artifactTitle(input, text, fallback) {
  return String(input.provenance?.filename || input.provenance?.name || input.content_json?.filename || fallback || text.slice(0, 160) || 'Artifact').slice(0, 200);
}

export function classifyEvent(input) {
  const text = normalizeText(input.content_text || input.text || '');
  const lower = text.toLowerCase();
  const contentType = String(input.content_type || 'text').toLowerCase();
  const source = String(input.source || '').toLowerCase();
  const extractions = [];

  const add = (kind, title, importance, confidence, structured = {}) => {
    const body = text || structured.summary || title || '';
    extractions.push({
      kind,
      title,
      body,
      importance,
      confidence,
      structured,
      canonical_key: `${kind}:${hashContent(`${title || ''}|${body}|${JSON.stringify(structured || {})}`)}`
    });
  };

  const fileLike = ['file', 'document', 'pdf', 'image', 'audio', 'video', 'spreadsheet', 'presentation'].includes(contentType)
    || Boolean(input.provenance?.filename || input.content_json?.filename);
  const engineeringLike = ['code', 'patch', 'diff', 'repository', 'commit', 'pull_request', 'issue'].includes(contentType)
    || source === 'github'
    || Boolean(input.provenance?.repository || input.provenance?.repo)
    || /\b(commit|pull request|\bpr\b|repository|repo|source code|patch|diff|branch)\b/i.test(text);

  if (fileLike) {
    add('artifact', artifactTitle(input, text, 'File artifact'), 72, 0.9, {
      content_type: contentType,
      filename: input.provenance?.filename || input.content_json?.filename || null,
      mime_type: input.provenance?.mime_type || input.content_json?.mime_type || null,
      source: input.source || null
    });
  }
  if (engineeringLike) {
    add('engineering_artifact', artifactTitle(input, text, 'Engineering artifact'), 78, 0.86, {
      content_type: contentType,
      repository: input.provenance?.repository || input.provenance?.repo || null,
      source: input.source || null
    });
  }
  if (/\b(todo|to do|need to|must|remember to|remind me|next action|task)\b/i.test(text)) add('task', text.slice(0, 160), 75, 0.78);
  if (/\b(decided|decision|we will|we'll use|chosen|canonical|rule:)\b/i.test(text)) add('decision', text.slice(0, 160), 85, 0.82);
  if (/\b(project|repo|prd|module|architecture|implementation|milestone)\b/i.test(text)) add('project_update', text.slice(0, 160), 70, 0.72, { project_hint: input.project_hint || null });
  if (/\b(appointment|meeting|dentist|doctor|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|at \d{1,2}(:\d{2})?)\b/i.test(lower)) add('commitment_candidate', text.slice(0, 160), 80, 0.64);
  if (/\b(client|customer|lead|prospect|contact|phone|email|whatsapp)\b/i.test(lower)) add('contact_or_sales', text.slice(0, 160), 65, 0.66);
  if (/\b(learned|studied|lesson|course|progress|mastered|practice)\b/i.test(lower)) add('learning_progress', text.slice(0, 160), 60, 0.68);
  if (/\b(prefer|from now on|always|never|my goal|i want atlas|remember that)\b/i.test(lower)) add('memory_candidate', text.slice(0, 160), 70, 0.72);

  const importance = Math.max(10, ...extractions.map(x => x.importance));
  return { importance, confidence: extractions.length ? Math.max(...extractions.map(x => x.confidence)) : 0.5, extractions };
}

export function routingPlan(extraction) {
  switch (extraction.kind) {
    case 'task': return ['neon', 'notion'];
    case 'decision': return ['neon', 'notion'];
    case 'project_update': return ['neon', 'notion'];
    case 'commitment_candidate': return ['neon', 'calendar_review'];
    case 'contact_or_sales': return ['neon'];
    case 'learning_progress': return ['neon', 'notion'];
    case 'memory_candidate': return ['neon', 'chatgpt_memory_candidate'];
    case 'artifact': return ['neon', 'drive'];
    case 'engineering_artifact': return ['neon', 'github'];
    default: return ['neon'];
  }
}

async function preserveRevision(client, existing, newHash) {
  if (!existing || existing.content_hash === newHash) return false;
  await client.query(`
    INSERT INTO atlas_event_revisions
      (event_id, content_text, content_json, content_hash, language, project_hint, sensitivity, importance, confidence, provenance)
    VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10::jsonb)
  `, [
    existing.id, existing.content_text, JSON.stringify(existing.content_json || {}), existing.content_hash,
    existing.language, existing.project_hint, existing.sensitivity, existing.importance, existing.confidence,
    JSON.stringify(existing.provenance || {})
  ]);
  return true;
}

export async function ingestEvent(input) {
  if (!input?.source) throw new Error('source is required');
  const userId = input.user_id || process.env.ATLAS_USER_ID || 'default';
  const text = normalizeText(input.content_text || input.text || '');
  const contentJson = input.content_json || {};
  const contentHash = hashContent(text || JSON.stringify(contentJson));
  const classified = classifyEvent({ ...input, content_text: text });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let existing = null;
    if (input.source_event_id) {
      const found = await client.query(`
        SELECT id::text, content_text, content_json, content_hash, language, project_hint, sensitivity, importance, confidence, provenance
        FROM atlas_events
        WHERE user_id=$1 AND source=$2 AND source_event_id=$3
        FOR UPDATE
      `, [userId, input.source, input.source_event_id]);
      existing = found.rows[0] || null;
      await preserveRevision(client, existing, contentHash);
    }

    const inserted = await client.query(`
      INSERT INTO atlas_events
        (user_id, source, source_event_id, thread_id, session_id, actor, occurred_at,
         content_type, content_text, content_json, content_hash, language, project_hint,
         sensitivity, importance, confidence, provenance)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()),$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb)
      ON CONFLICT (user_id, source, source_event_id)
      DO UPDATE SET
        updated_at=now(), thread_id=EXCLUDED.thread_id, session_id=EXCLUDED.session_id,
        actor=EXCLUDED.actor, occurred_at=EXCLUDED.occurred_at, content_type=EXCLUDED.content_type,
        content_text=EXCLUDED.content_text, content_json=EXCLUDED.content_json, content_hash=EXCLUDED.content_hash,
        language=EXCLUDED.language, project_hint=EXCLUDED.project_hint, sensitivity=EXCLUDED.sensitivity,
        importance=EXCLUDED.importance, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance
      RETURNING id::text
    `, [
      userId, input.source, input.source_event_id || null, input.thread_id || null,
      input.session_id || null, input.actor || null, input.occurred_at || null,
      input.content_type || 'text', text || null, JSON.stringify(contentJson),
      contentHash, input.language || null, input.project_hint || null,
      input.sensitivity || 'normal', classified.importance, classified.confidence,
      JSON.stringify(input.provenance || {})
    ]);

    const eventId = inserted.rows[0].id;
    const created = [];
    const deduplicated = [];
    for (const extraction of classified.extractions) {
      const exists = await client.query(
        'SELECT id::text FROM atlas_extractions WHERE user_id=$1 AND canonical_key=$2 ORDER BY created_at ASC LIMIT 1',
        [userId, extraction.canonical_key]
      );
      if (exists.rowCount) {
        const extractionId = exists.rows[0].id;
        await client.query(`
          INSERT INTO atlas_extraction_evidence(extraction_id,event_id)
          VALUES ($1,$2)
          ON CONFLICT (extraction_id,event_id) DO UPDATE SET observed_at=now()
        `, [extractionId, eventId]);
        deduplicated.push({ extraction_id: extractionId, kind: extraction.kind, canonical_key: extraction.canonical_key });
        continue;
      }

      const row = await client.query(`
        INSERT INTO atlas_extractions
          (event_id,user_id,kind,title,body,structured,importance,confidence,canonical_key)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
        RETURNING id::text
      `, [eventId,userId,extraction.kind,extraction.title,extraction.body,
          JSON.stringify(extraction.structured || {}),extraction.importance,
          extraction.confidence,extraction.canonical_key]);
      const extractionId = row.rows[0].id;
      await client.query(`
        INSERT INTO atlas_extraction_evidence(extraction_id,event_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `, [extractionId, eventId]);
      const destinations = routingPlan(extraction);
      for (const destination of destinations) {
        await client.query(`
          INSERT INTO atlas_routing_log(event_id,extraction_id,destination,action,status,reason)
          VALUES ($1,$2,$3,'route','pending',$4)
        `, [eventId, extractionId, destination, `Automatic route for ${extraction.kind}`]);
      }
      created.push({ id: extractionId, ...extraction, destinations });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      event_id: eventId,
      revised_existing_event: Boolean(existing && existing.content_hash !== contentHash),
      importance: classified.importance,
      extractions: created,
      deduplicated_evidence: deduplicated
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeIngestionPool() {
  await pool.end();
}
