import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const SCHEMA_VERSION = '2026-08-15.cx003';

const CONNECTORS = Object.freeze([
  {
    id: 'neon',
    provider: 'neon',
    category: 'canonical_state',
    auth_state: 'database_url',
    scopes: ['canonical.read', 'canonical.write'],
    capabilities: ['projects', 'tasks', 'memory', 'ingestion', 'audit'],
    risk_classes: ['data', 'mutation', 'canonical'],
    pagination_mode: 'none',
    execution_plane: 'server',
    remediation: 'Verify DATABASE_URL reachability and canonical migration health before claiming Neon is healthy.',
    configured: env => Boolean(env.DATABASE_URL),
    stable_identities: env => ({ service_id: 'neon', database_name: 'neondb', user_id: env.ATLAS_USER_ID || null })
  },
  {
    id: 'notion',
    provider: 'notion',
    category: 'knowledge_mirror',
    auth_state: 'token_or_webhook',
    scopes: ['mirror.read', 'mirror.write'],
    capabilities: ['mirror', 'documentation'],
    risk_classes: ['external_write', 'knowledge'],
    pagination_mode: 'cursor',
    execution_plane: 'connector',
    remediation: 'Restore NOTION_TOKEN or ATLAS_ROUTE_NOTION_URL and verify a live mirror write before resuming automatic routing.',
    configured: env => Boolean(env.NOTION_TOKEN || env.ATLAS_ROUTE_NOTION_URL),
    stable_identities: env => ({ service_id: 'notion', route_env: env.ATLAS_ROUTE_NOTION_URL ? 'ATLAS_ROUTE_NOTION_URL' : null })
  },
  {
    id: 'drive',
    provider: 'google_drive',
    category: 'files',
    auth_state: 'webhook',
    scopes: ['files.read', 'files.write'],
    capabilities: ['files', 'artifacts', 'backup'],
    risk_classes: ['external_write', 'artifacts'],
    pagination_mode: 'cursor',
    execution_plane: 'connector',
    remediation: 'Restore ATLAS_ROUTE_DRIVE_URL and verify a real artifact delivery before marking Drive healthy.',
    configured: env => Boolean(env.ATLAS_ROUTE_DRIVE_URL),
    stable_identities: env => ({ service_id: 'drive', route_env: env.ATLAS_ROUTE_DRIVE_URL ? 'ATLAS_ROUTE_DRIVE_URL' : null })
  },
  {
    id: 'github',
    provider: 'github',
    category: 'engineering',
    auth_state: 'webhook',
    scopes: ['repo.read', 'repo.write'],
    capabilities: ['source', 'issues', 'pull_requests'],
    risk_classes: ['external_write', 'engineering'],
    pagination_mode: 'cursor',
    execution_plane: 'connector',
    remediation: 'Restore ATLAS_ROUTE_GITHUB_URL and verify a GitHub receipt before automatic engineering routing resumes.',
    configured: env => Boolean(env.ATLAS_ROUTE_GITHUB_URL),
    stable_identities: env => ({ service_id: 'github', route_env: env.ATLAS_ROUTE_GITHUB_URL ? 'ATLAS_ROUTE_GITHUB_URL' : null })
  },
  {
    id: 'calendar',
    provider: 'google_calendar',
    category: 'commitments',
    auth_state: 'webhook',
    scopes: ['calendar.read', 'calendar.write'],
    capabilities: ['schedule', 'commitments'],
    risk_classes: ['external_write', 'high_impact'],
    pagination_mode: 'sync_token',
    execution_plane: 'connector',
    remediation: 'Keep uncertain commitments review-gated and verify ATLAS_ROUTE_CALENDAR_URL before any automatic calendar mutation.',
    configured: env => Boolean(env.ATLAS_ROUTE_CALENDAR_URL),
    stable_identities: env => ({ service_id: 'calendar', route_env: env.ATLAS_ROUTE_CALENDAR_URL ? 'ATLAS_ROUTE_CALENDAR_URL' : null })
  },
  {
    id: 'gmail',
    provider: 'gmail',
    category: 'communications',
    auth_state: 'webhook',
    scopes: ['gmail.read', 'gmail.write'],
    capabilities: ['email'],
    risk_classes: ['external_write', 'communications'],
    pagination_mode: 'page_token',
    execution_plane: 'connector',
    remediation: 'Restore ATLAS_ROUTE_GMAIL_URL and verify an email routing receipt before resuming automatic delivery.',
    configured: env => Boolean(env.ATLAS_ROUTE_GMAIL_URL),
    stable_identities: env => ({ service_id: 'gmail', route_env: env.ATLAS_ROUTE_GMAIL_URL ? 'ATLAS_ROUTE_GMAIL_URL' : null })
  },
  {
    id: 'chatgpt_memory',
    provider: 'chatgpt',
    category: 'memory_mirror',
    auth_state: 'webhook',
    scopes: ['memory.candidate'],
    capabilities: ['memory_candidate'],
    risk_classes: ['external_write', 'sensitive'],
    pagination_mode: 'none',
    execution_plane: 'connector',
    remediation: 'Memory candidate routing must remain review-gated unless privacy policy explicitly allows automated delivery.',
    configured: env => Boolean(env.ATLAS_ROUTE_MEMORY_URL),
    stable_identities: env => ({ service_id: 'chatgpt_memory', route_env: env.ATLAS_ROUTE_MEMORY_URL ? 'ATLAS_ROUTE_MEMORY_URL' : null })
  },
  {
    id: 'voice',
    provider: 'voice_service',
    category: 'voice',
    auth_state: 'probe_only',
    scopes: ['stt', 'tts'],
    capabilities: ['stt', 'tts'],
    risk_classes: ['media', 'external'],
    pagination_mode: 'none',
    execution_plane: 'connector',
    remediation: 'Do not claim voice availability from configuration alone; require a live probe or verified transcript ingress path.',
    configured: env => Boolean(env.ATLAS_HEALTH_VOICE_URL),
    stable_identities: env => ({ service_id: 'voice', probe_env: env.ATLAS_HEALTH_VOICE_URL ? 'ATLAS_HEALTH_VOICE_URL' : null })
  }
]);

function userId() {
  return process.env.ATLAS_USER_ID || 'default';
}

export function listConnectorDefinitions() {
  return CONNECTORS.map(connector => ({ ...connector }));
}

function defaultConnectorRecord(connector, env = process.env) {
  const configured = connector.configured(env);
  return {
    connector_id: connector.id,
    provider: connector.provider,
    category: connector.category,
    stable_identities: connector.stable_identities(env),
    auth_state: configured ? connector.auth_state : 'missing',
    scopes: [...connector.scopes],
    capabilities: [...connector.capabilities],
    risk_classes: [...connector.risk_classes],
    pagination_mode: connector.pagination_mode,
    schema_version: SCHEMA_VERSION,
    execution_plane: connector.execution_plane,
    remediation: connector.remediation,
    configured,
    health: configured ? 'unknown' : 'offline',
    last_read_test: null,
    last_write_test: null,
    last_success_at: null,
    last_error: configured ? null : 'connector is not configured',
    metadata: { derived_from_runtime: true }
  };
}

function mergeConnectorRecord(base, row = {}) {
  return {
    ...base,
    provider: row.provider || base.provider,
    category: row.category || base.category,
    stable_identities: row.stable_identities || base.stable_identities,
    auth_state: row.auth_state || base.auth_state,
    scopes: row.scopes || base.scopes,
    capabilities: row.capabilities || base.capabilities,
    risk_classes: row.risk_classes || base.risk_classes,
    pagination_mode: row.pagination_mode || base.pagination_mode,
    schema_version: row.schema_version || base.schema_version,
    execution_plane: row.execution_plane || base.execution_plane,
    remediation: row.remediation || base.remediation,
    configured: row.configured ?? base.configured,
    health: row.health || base.health,
    last_read_test: row.last_read_test || base.last_read_test,
    last_write_test: row.last_write_test || base.last_write_test,
    last_success_at: row.last_success_at || base.last_success_at,
    last_error: row.last_error ?? base.last_error,
    metadata: row.metadata || base.metadata,
    updated_at: row.updated_at || null
  };
}

export async function atlasConnectors({ include_unconfigured = true } = {}) {
  const connectors = new Map(CONNECTORS.map(connector => [connector.id, defaultConnectorRecord(connector)]));
  try {
    const [installations, sources, health] = await Promise.all([
      pool.query(`
        SELECT connector_id, provider, category, stable_identities, auth_state, scopes, capabilities,
               risk_classes, pagination_mode, schema_version, execution_plane, remediation,
               configured, health, last_read_test, last_write_test, last_success_at, last_error,
               metadata, updated_at
        FROM atlas_connector_installations
        WHERE user_id=$1
      `, [userId()]),
      pool.query(`
        SELECT source, health, last_success_at, last_error, updated_at
        FROM atlas_source_registry
        WHERE user_id=$1
      `, [userId()]),
      pool.query(`
        SELECT DISTINCT ON (service_id) service_id, health, failure_summary, checked_at
        FROM atlas_health_checks
        WHERE user_id=$1
        ORDER BY service_id, checked_at DESC
      `, [userId()])
    ]);

    for (const row of installations.rows) {
      const base = connectors.get(row.connector_id) || {
        connector_id: row.connector_id,
        provider: row.provider || row.connector_id,
        category: row.category || 'external',
        stable_identities: {},
        auth_state: row.auth_state || 'unknown',
        scopes: row.scopes || [],
        capabilities: row.capabilities || [],
        risk_classes: row.risk_classes || [],
        pagination_mode: row.pagination_mode || 'unknown',
        schema_version: row.schema_version || SCHEMA_VERSION,
        execution_plane: row.execution_plane || 'connector',
        remediation: row.remediation || null,
        configured: row.configured ?? false,
        health: row.health || 'unknown',
        last_read_test: null,
        last_write_test: null,
        last_success_at: null,
        last_error: null,
        metadata: row.metadata || {}
      };
      connectors.set(row.connector_id, mergeConnectorRecord(base, row));
    }

    const healthById = new Map(health.rows.map(row => [row.service_id, row]));
    for (const row of sources.rows) {
      const current = connectors.get(row.source);
      if (!current) continue;
      const live = healthById.get(row.source);
      connectors.set(row.source, {
        ...current,
        health: live?.health || row.health || current.health,
        last_success_at: row.last_success_at || current.last_success_at,
        last_error: live?.failure_summary || row.last_error || current.last_error,
        metadata: {
          ...(current.metadata || {}),
          source_registry_updated_at: row.updated_at,
          last_health_checked_at: live?.checked_at || null
        }
      });
    }

    for (const [connectorId, live] of healthById.entries()) {
      const current = connectors.get(connectorId);
      if (!current) continue;
      connectors.set(connectorId, {
        ...current,
        health: live.health || current.health,
        last_error: live.failure_summary || current.last_error,
        metadata: {
          ...(current.metadata || {}),
          last_health_checked_at: live.checked_at || null
        }
      });
    }
  } catch (error) {
    if (error?.code !== '42P01') throw error;
  }

  const rows = [...connectors.values()].sort((a, b) => a.connector_id.localeCompare(b.connector_id));
  return include_unconfigured ? rows : rows.filter(row => row.configured);
}

export async function closeConnectorRegistryPool() {
  await pool.end();
}
