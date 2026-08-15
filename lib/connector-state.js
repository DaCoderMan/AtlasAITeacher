export const CONNECTOR_TERMINAL_STATUSES = new Set(['permission_denied', 'auth_required', 'schema_mismatch']);
export const CONNECTOR_RETRYABLE_STATUSES = new Set(['waiting_connector', 'rate_limited', 'provider_offline', 'failed']);

export function classifyConnectorFailure(error) {
  const message = String(error?.message || error || '');
  const status = Number(error?.responseStatus || error?.status || 0);
  if (status === 401) return { status: 'auth_required', retryable: false, reason: 'connector returned 401' };
  if (status === 403) return { status: 'permission_denied', retryable: false, reason: 'connector returned 403' };
  if (status === 429) return { status: 'rate_limited', retryable: true, reason: 'connector returned 429' };
  if ([400, 404, 409, 410, 422].includes(status)) return { status: 'schema_mismatch', retryable: false, reason: `connector returned ${status}` };
  if (status >= 500) return { status: 'provider_offline', retryable: true, reason: `connector returned ${status}` };
  if (/schema|validation|invalid|unsupported/i.test(message)) return { status: 'schema_mismatch', retryable: false, reason: 'validation_or_schema_failure' };
  if (/permission|forbidden|insufficient_scope/i.test(message)) return { status: 'permission_denied', retryable: false, reason: 'permission_failure' };
  if (/unauthorized|auth/i.test(message)) return { status: 'auth_required', retryable: false, reason: 'authentication_failure' };
  if (/rate limit|429/i.test(message)) return { status: 'rate_limited', retryable: true, reason: 'rate_limited' };
  if (/timeout|timed out|abort|5\\d\\d/i.test(message)) return { status: 'provider_offline', retryable: true, reason: 'provider_unavailable' };
  return { status: 'failed', retryable: true, reason: 'unclassified_failure' };
}

export function classifyConnectorRuntimeState({ configured, health, last_error } = {}) {
  if (!configured) return 'waiting_connector';
  if (health === 'healthy') return 'ready';
  if (health === 'offline') return 'provider_offline';
  const failure = classifyConnectorFailure({ message: last_error || '', status: 0 });
  if (last_error && failure.status !== 'failed') return failure.status;
  if (health === 'degraded') return 'degraded';
  if (health === 'unknown') return 'unknown';
  return 'ready';
}
