# Codex Bridge Status

Initialized: 2026-08-17
Tracking issue: #11

Current scaffold:

- `docs/CODEX_COMMAND_BRIDGE.md` — architecture, lifecycle, safety and acceptance criteria.
- `scripts/atlas-codex.js` — gated local CLI/worker scaffold with health, pull, next, report, run, watch and doctor commands.
- `systemd/atlas-codex.service.example` — user-service example for the Ubuntu worker.
- `package.json` — includes `codex:atlas` and syntax checking for the worker.

Important: Codex process execution is intentionally disabled in the scaffold until the canonical API job endpoints, repository allowlist, approval policy, lease/heartbeat and result contract are implemented and tested. This prevents a half-built bridge from executing arbitrary local commands.

Next implementation target:

1. Complete Atlas API v1 job lifecycle.
2. Implement server-side codex job store/lease logic.
3. Add worker repository registry and allowlist.
4. Add deterministic Codex CLI invocation wrapper.
5. Add heartbeat/result/cancel/retry behavior.
6. Add E2E tests in disposable repo/worktree.
7. Enable execution only after safety tests pass.
