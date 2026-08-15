import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const INGESTION_EXTRACTOR_VERSION = 'atlas-ingestion-v2.2026-08-15';
const PRIVACY_CLASSES = new Set(['public', 'internal', 'personal', 'sensitive', 'secret']);

function hashContent(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function normalizeText(value = '') {
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function artifactTitle(input, text, fallback) {
  return String(input.provenance?.filename || input.provenance?.name || input.content_json?.filename || fallback || text.slice(0, 160) || 'Artifact').slice(0, 200);
}

function stableSourceEventKey(input, contentHash) {
  const source = String(input.source || '').trim() || 'unknown';
  const sourceEventId = String(input.source_event_id || '').trim();
  if (sourceEventId) return `${source}:${sourceEventId}`;
  const material = [
    source,
    input.thread_id || '',
    input.session_id || '',
    input.actor || '',
    input.occurred_at || '',
    contentHash
  ].join('|');
  return `${source}:sha256:${hashContent(material)}`;
}

function nextRevisionCount(existing, revised) {
  return Math.max(0, Number(existing?.provenance?.revision_count) || 0) + (revised ? 1 : 0);
}

function normalizedSource(input = {}) {
  return String(input.source || '').trim().toLowerCase();
}

function normalizedSensitivity(input = {}) {
  return String(input.sensitivity || input.provenance?.sensitivity || 'normal').trim().toLowerCase();
}

export function privacyClassForEvent(input = {}) {
  const explicit = String(input.provenance?.privacy_class || '').trim().toLowerCase();
  if (PRIVACY_CLASSES.has(explicit)) return explicit;

  const sensitivity = normalizedSensitivity(input);
  if (sensitivity === 'secret') return 'secret';
  if (['restricted', 'highly_sensitive', 'sensitive'].includes(sensitivity)) return 'sensitive';

  const source = normalizedSource(input);
  if (['gmail', 'whatsapp', 'chatgpt_text', 'chatgpt_voice', 'voice_transcript'].includes(source)) {
    return 'personal';
  }

  return 'internal';
}

export function retentionClassForPrivacy(privacyClass) {
  switch (privacyClass) {
    case 'secret': return 'secret_rejected';
    case 'sensitive': return 'local_only';
    case 'personal': return 'standard';
    case 'public': return 'durable';
    case 'internal':
    default:
      return 'durable';
  }
}

export function allowedDestinationsForPrivacy(privacyClass, routeDestinations = []) {
  if (privacyClass === 'secret') return [];
  if (privacyClass === 'sensitive') return ['neon'];
  return [...new Set(routeDestinations.map(destination => String(destination).trim()).filter(Boolean))];
}

export function routePrivacyMetadata(input = {}, routeDestinations = [], destination = null) {
  const privacy_class = privacyClassForEvent(input);
  const retention_class = retentionClassForPrivacy(privacy_class);
  const allowed_destinations = allowedDestinationsForPrivacy(privacy_class, routeDestinations);
  const normalizedDestination = destination ? String(destination).trim() : null;
  const externalDestination = normalizedDestination && normalizedDestination !== 'neon';
  return {
    privacy_class,
    retention_class,
    allowed_destinations,
    deletion_policy: externalDestination ? 'source_tombstone_then_external_cleanup' : 'canonical_authority',
    tombstone_required: Boolean(externalDestination),
    external_ref_cleanup_required: Boolean(externalDestination),
    local_only_enforced: privacy_class === 'secret' || privacy_class === 'sensitive'
  };
}

export function buildIngestionProvenance(input, {
  contentHash,
  classified,
  existing = null,
  revision = null
} = {}) {
  const next = { ...(input.provenance && typeof input.provenance === 'object' ? input.provenance : {}) };
  const revised = Boolean(revision);
  next.ingestion_contract_version = 'atlas-universal-ingestion.v2';
  next.extractor_version = INGESTION_EXTRACTOR_VERSION;
  next.source_event_key = stableSourceEventKey(input, contentHash);
  next.source_content_hash = contentHash;
  next.source_event_id = input.source_event_id || next.source_event_id || null;
  next.duplicate_cluster = next.duplicate_cluster || hashContent([
    String(input.source || ''),
    String(input.project_hint || ''),
    contentHash
  ].join('|'));
  next.revision_count = nextRevisionCount(existing, revised);
  next.extraction_count = Array.isArray(classified?.extractions) ? classified.extractions.length : 0;
  next.privacy_class = privacyClassForEvent(input);
  next.retention_class = retentionClassForPrivacy(next.privacy_class);
  if (!next.first_observed_at) next.first_observed_at = existing?.provenance?.first_observed_at || new Date().toISOString();
  next.last_observed_at = new Date().toISOString();
  if (revised) {
    next.supersedes = {
      revision_id: revision.id,
      revised_at: revision.revised_at,
      content_hash: revision.content_hash,
      provenance: revision.provenance || {}
    };
  } else if (existing?.id) {
    next.last_observed_duplicate_of = existing.id;
  }
  return next;
}

export function annotateExtractionStructured(structured = {}, {
  eventId,
  sourceEventKey,
  duplicateCluster,
  routeReceipts = []
} = {}) {
  return {
    ...(structured || {}),
    _atlas: {
      derived_from_event_id: eventId || null,
      extractor_version: INGESTION_EXTRACTOR_VERSION,
      source_event_key: sourceEventKey || null,
      duplicate_cluster: duplicateCluster || null,
      route_receipts: routeReceipts.map(receipt => ({
        destination: receipt.destination,
        status: receipt.status || 'pending',
        privacy_class: receipt.privacy_class || null,
        retention_class: receipt.retention_class || null,
        allowed_destinations: receipt.allowed_destinations || [],
        deletion_policy: receipt.deletion_policy || null,
        tombstone_required: Boolean(receipt.tombstone_required),
        external_ref_cleanup_required: Boolean(receipt.external_ref_cleanup_required)
      }))
    }
  };
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
  const preserved = await client.query(`
    INSERT INTO atlas_event_revisions
      (event_id, content_text, content_json, content_hash, language, project_hint, sensitivity, importance, confidence, provenance)
    VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10::jsonb)
    RETURNING id::text, content_hash, provenance, revised_at
  `, [
    existing.id, existing.content_text, JSON.stringify(existing.content_json || {}), existing.content_hash,
    existing.language, existing.project_hint, existing.sensitivity, existing.importance, existing.confidence,
    JSON.stringify(existing.provenance || {})
  ]);
  return preserved.rows[0];
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
    }
    const revision = await preserveRevision(client, existing, contentHash);
    const provenance = buildIngestionProvenance(input, { contentHash, classified, existing, revision });

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
      JSON.stringify(provenance)
    ]);

    const eventId = inserted.rows[0].id;
    const created = [];
    const deduplicated = [];
    const sourceEventKey = provenance.source_event_key;
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
        deduplicated.push({
          extraction_id: extractionId,
          kind: extraction.kind,
          canonical_key: extraction.canonical_key,
          duplicate_cluster: extraction.canonical_key,
          source_event_key: sourceEventKey
        });
        continue;
      }

      const destinations = routingPlan(extraction);
      const routeReceiptPlans = destinations.map(destination => ({
        destination,
        status: 'pending',
        ...routePrivacyMetadata(input, destinations, destination)
      }));
      const structured = annotateExtractionStructured(extraction.structured, {
        eventId,
        sourceEventKey,
        duplicateCluster: extraction.canonical_key,
        routeReceipts: routeReceiptPlans
      });
      const row = await client.query(`
        INSERT INTO atlas_extractions
          (event_id,user_id,kind,title,body,structured,importance,confidence,canonical_key)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
        RETURNING id::text
      `, [eventId,userId,extraction.kind,extraction.title,extraction.body,
          JSON.stringify(structured),extraction.importance,
          extraction.confidence,extraction.canonical_key]);
      const extractionId = row.rows[0].id;
      await client.query(`
        INSERT INTO atlas_extraction_evidence(extraction_id,event_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `, [extractionId, eventId]);
      const routeReceipts = [];
      for (const destination of destinations) {
        const route = await client.query(`
          INSERT INTO atlas_routing_log(event_id,extraction_id,destination,action,status,reason,details)
          VALUES ($1,$2,$3,'route','pending',$4,$5::jsonb)
          RETURNING id::text, status, created_at
        `, [
          eventId,
          extractionId,
          destination,
          `Automatic route for ${extraction.kind}`,
          JSON.stringify({
            route_receipt: {
              source_event_key: sourceEventKey,
              duplicate_cluster: extraction.canonical_key,
              extractor_version: INGESTION_EXTRACTOR_VERSION,
              ...routePrivacyMetadata(input, destinations, destination)
            }
          })
        ]);
        routeReceipts.push({
          route_id: route.rows[0].id,
          destination,
          status: route.rows[0].status,
          created_at: route.rows[0].created_at
        });
      }
      created.push({
        id: extractionId,
        ...extraction,
        structured,
        destinations,
        duplicate_cluster: extraction.canonical_key,
        source_event_key: sourceEventKey,
        route_receipts: routeReceipts
      });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      event_id: eventId,
      revised_existing_event: Boolean(revision),
      ingestion_contract_version: provenance.ingestion_contract_version,
      extractor_version: provenance.extractor_version,
      source_event_key: provenance.source_event_key,
      duplicate_cluster: provenance.duplicate_cluster,
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
