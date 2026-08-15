import crypto from 'node:crypto';
import { getQualityGateStatus } from './quality-gate.js';

function textHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniqueKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return [...new Set(keywords.map(item => String(item || '').trim()).filter(Boolean))];
}

function isTranscriptEvent(event = {}) {
  return event.content_type === 'voice_transcript'
    || event.source === 'chatgpt_voice'
    || event.provenance?.voice_transcript === true
    || event.content_json?.message_type === 'audio';
}

export function enrichTranscriptEvent(event, options = {}) {
  if (!event || typeof event !== 'object' || !isTranscriptEvent(event)) return event;

  const requested = options.enabled !== false;
  const gate = getQualityGateStatus();
  const control = gate.controls.transcript_enrichment;
  const content_json = { ...(event.content_json || {}) };
  const provenance = { ...(event.provenance || {}) };

  if (!requested || !control.enabled) {
    return {
      ...event,
      content_json: {
        ...content_json,
        transcript_enrichment: {
          status: 'disabled',
          reason: requested ? control.reason : 'feature_disabled',
          authoritative_source_event_id: event.source_event_id || null
        }
      },
      provenance: {
        ...provenance,
        transcript_enrichment: {
          status: 'disabled',
          reason: requested ? control.reason : 'feature_disabled',
          preserved_source_event_id: event.source_event_id || null,
          preserved_source: event.source || null
        }
      }
    };
  }

  const enrichment = {
    status: 'enabled',
    enrichment_version: options.version || 'atlas-transcript-enrichment.v1',
    authoritative_source_event_id: event.source_event_id || null,
    authoritative_source: event.source || null,
    source_content_hash: textHash(event.content_text),
    summary: options.summary || null,
    keywords: uniqueKeywords(options.keywords),
    quality_eval_id: gate.evaluation.eval_id || null
  };

  return {
    ...event,
    content_json: {
      ...content_json,
      transcript_enrichment: enrichment
    },
    provenance: {
      ...provenance,
      transcript_enrichment: {
        ...enrichment,
        preserved_source_event_id: event.source_event_id || null,
        preserved_source: event.source || null
      }
    }
  };
}
