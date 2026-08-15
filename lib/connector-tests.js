const CONNECTOR_TEST_PLANS = Object.freeze({
  neon: {
    read_test: {
      kind: 'live_sql_probe',
      safety: 'harmless_read',
      description: 'Run a bounded canonical read such as SELECT 1 or a metadata query against the configured Neon branch.',
      cleanup_required: false
    },
    write_test: {
      kind: 'disposable_task_probe',
      safety: 'reversible_write',
      description: 'Create a disposable low-priority canonical task, verify read-back, then cancel it and confirm cleanup state.',
      cleanup_required: true,
      cleanup_verification: 'task_status_cancelled'
    }
  },
  notion: {
    read_test: {
      kind: 'health_webhook_probe',
      safety: 'harmless_read',
      description: 'Use the configured health endpoint or read-only connector probe before any mirror write is considered healthy.',
      cleanup_required: false
    },
    write_test: {
      kind: 'sandbox_page_write',
      safety: 'reversible_write',
      description: 'Write to a disposable or explicitly sandboxed page/database entry and confirm deletion or archival afterward.',
      cleanup_required: true,
      cleanup_verification: 'sandbox_page_removed'
    }
  },
  drive: {
    read_test: {
      kind: 'artifact_health_probe',
      safety: 'harmless_read',
      description: 'Verify Drive connector availability through a bounded file metadata/list probe.',
      cleanup_required: false
    },
    write_test: {
      kind: 'scratch_file_upload',
      safety: 'reversible_write',
      description: 'Upload a disposable scratch artifact to a designated test location, verify receipt, then delete it and confirm removal.',
      cleanup_required: true,
      cleanup_verification: 'scratch_file_deleted'
    }
  },
  github: {
    read_test: {
      kind: 'repository_metadata_probe',
      safety: 'harmless_read',
      description: 'Read repository metadata or issue list without mutating GitHub state.',
      cleanup_required: false
    },
    write_test: {
      kind: 'sandbox_issue_comment',
      safety: 'reversible_write',
      description: 'Post into a sandbox issue/discussion and remove or close the disposable artifact when supported.',
      cleanup_required: true,
      cleanup_verification: 'sandbox_github_artifact_removed_or_closed'
    }
  },
  calendar: {
    read_test: {
      kind: 'calendar_availability_probe',
      safety: 'harmless_read',
      description: 'Read availability or a designated test calendar feed before any event creation is attempted.',
      cleanup_required: false
    },
    write_test: {
      kind: 'disposable_event_create',
      safety: 'reversible_write',
      description: 'Create a clearly labeled disposable event in a test calendar, verify read-back, then delete it and confirm absence.',
      cleanup_required: true,
      cleanup_verification: 'disposable_event_deleted'
    }
  },
  gmail: {
    read_test: {
      kind: 'mailbox_metadata_probe',
      safety: 'harmless_read',
      description: 'Read mailbox metadata or a bounded message list without sending or modifying user mail.',
      cleanup_required: false
    },
    write_test: {
      kind: 'draft_lifecycle_probe',
      safety: 'reversible_write',
      description: 'Create a disposable draft in a test mailbox, verify listing, then delete it and confirm it is gone.',
      cleanup_required: true,
      cleanup_verification: 'draft_deleted'
    }
  },
  chatgpt_memory: {
    read_test: {
      kind: 'candidate_route_probe',
      safety: 'harmless_read',
      description: 'Verify candidate-routing configuration without writing durable memory automatically.',
      cleanup_required: false
    },
    write_test: null
  },
  voice: {
    read_test: {
      kind: 'voice_health_probe',
      safety: 'harmless_read',
      description: 'Use a health endpoint or transcript ingress probe only; do not assume raw audio access.',
      cleanup_required: false
    },
    write_test: null
  }
});

export function connectorTestPlan(connectorId) {
  return CONNECTOR_TEST_PLANS[connectorId] || {
    read_test: {
      kind: 'manual_probe',
      safety: 'harmless_read',
      description: 'No connector-specific probe is registered yet.',
      cleanup_required: false
    },
    write_test: null
  };
}

export function listConnectorTestPlans() {
  return Object.entries(CONNECTOR_TEST_PLANS).map(([connector_id, plan]) => ({ connector_id, ...plan }));
}
