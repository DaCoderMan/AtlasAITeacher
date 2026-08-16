# Atlas Release Gates

Before merging a large Atlas control-plane branch into `main`:

1. Branch must be rebased/merged from current `main` with conflicts resolved.
2. Current PR head must have a successful `Atlas CI` run.
3. OAuth/JWT scope enforcement smoke tests must pass.
4. MCP read/write authorization smoke tests must pass.
5. Universal ingestion dedupe/provenance tests must pass.
6. Reconciliation must leave one canonical live identity per real project/task while preserving superseded provenance.
7. No `[Atlas self-test]` records may remain active outside explicit test scope.
8. No known stale operational tasks may remain `waiting`/`in_progress` after their underlying action is complete.
9. Production secrets must be references/injected runtime values, never source or ordinary memory.
10. Deployment read-back must succeed before declaring production healthy.

A release failing any gate remains draft/not merge-ready.
