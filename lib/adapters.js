import crypto from 'node:crypto';
import { enrichTranscriptEvent } from './transcript-enrichment.js';

function stableId(parts) {
  return crypto.createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex');
}

export function fromChatGPTMessage(message, context = {}) {
  const text = message.content_text || message.text || message.content || '';
  const event = {
    user_id: context.user_id,
    source: context.voice ? 'chatgpt_voice' : 'chatgpt',
    source_event_id: message.id || stableId([context.conversation_id, message.role, message.created_at, text]),
    thread_id: context.conversation_id || message.conversation_id || null,
    session_id: context.session_id || null,
    actor: message.role || message.actor || null,
    occurred_at: message.created_at || message.timestamp || null,
    content_type: context.voice ? 'voice_transcript' : 'text',
    content_text: text,
    language: message.language || context.language || null,
    project_hint: context.project_hint || null,
    sensitivity: context.sensitivity || 'normal',
    provenance: {
      source_url: context.source_url || null,
      conversation_id: context.conversation_id || null,
      original_id: message.id || null,
      imported_via: context.imported_via || 'adapter',
      voice_transcript: Boolean(context.voice)
    }
  };
  return context.transcript_enrichment ? enrichTranscriptEvent(event, context.transcript_enrichment) : event;
}

export function fromWhatsAppMessage(message, context = {}) {
  const text = message.text?.body || message.text || message.body || '';
  const contact = message.contact_name || message.from || context.contact || null;
  const event = {
    user_id: context.user_id,
    source: 'whatsapp',
    source_event_id: message.id || stableId([context.chat_id, contact, message.timestamp, text]),
    thread_id: context.chat_id || message.chat_id || contact,
    actor: message.from_me ? 'user' : contact,
    occurred_at: message.occurred_at || message.timestamp || null,
    content_type: message.type === 'audio' ? 'voice_transcript' : 'message',
    content_text: text || message.transcript || '',
    language: message.language || context.language || null,
    project_hint: context.project_hint || null,
    sensitivity: context.sensitivity || 'normal',
    content_json: { message_type: message.type || 'text', contact },
    provenance: {
      original_id: message.id || null,
      chat_id: context.chat_id || message.chat_id || null,
      imported_via: context.imported_via || 'whatsapp_adapter',
      transcript_source: message.type === 'audio' ? (context.transcript_source || 'provided') : null
    }
  };
  return context.transcript_enrichment ? enrichTranscriptEvent(event, context.transcript_enrichment) : event;
}

export function fromGmailMessage(message, context = {}) {
  const text = message.text || message.body || message.snippet || '';
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(item => ({
    id: item.id || item.attachmentId || null,
    filename: item.filename || item.name || null,
    mime_type: item.mime_type || item.mimeType || null,
    size: item.size || null
  })) : [];
  return {
    user_id: context.user_id,
    source: 'gmail',
    source_event_id: message.id || stableId([message.threadId || message.thread_id, message.date || message.internalDate, message.from, text]),
    thread_id: message.threadId || message.thread_id || null,
    actor: message.from || null,
    occurred_at: message.date || message.internalDate || null,
    content_type: 'email',
    content_text: text,
    language: message.language || context.language || null,
    project_hint: context.project_hint || null,
    sensitivity: context.sensitivity || 'normal',
    content_json: {
      subject: message.subject || null,
      from: message.from || null,
      to: message.to || null,
      labels: message.labels || [],
      attachments
    },
    provenance: {
      original_id: message.id || null,
      thread_id: message.threadId || message.thread_id || null,
      attachment_count: attachments.length,
      imported_via: context.imported_via || 'gmail_adapter'
    }
  };
}

export function fromFile(file, context = {}) {
  const name = file.name || file.filename || 'unnamed';
  const mimeType = file.mime_type || file.type || null;
  const checksum = file.checksum || stableId([name, file.size, file.modified_at, file.text || '']);
  return {
    user_id: context.user_id,
    source: 'file',
    source_event_id: file.id || checksum,
    thread_id: context.thread_id || null,
    actor: context.actor || 'user',
    occurred_at: file.modified_at || file.created_at || null,
    content_type: 'file',
    content_text: file.text || file.summary || name,
    project_hint: context.project_hint || null,
    sensitivity: context.sensitivity || 'normal',
    content_json: {
      name,
      filename: name,
      mime_type: mimeType,
      size: file.size || null,
      checksum,
      durable_ref: file.durable_ref || null
    },
    provenance: {
      original_id: file.id || null,
      filename: name,
      mime_type: mimeType,
      checksum,
      durable_ref: file.durable_ref || null,
      source_url: file.url || null,
      imported_via: context.imported_via || 'file_adapter'
    }
  };
}
