# Atlas ↔ Codex Command Bridge

Issue: #11
Status: scaffolded for implementation

## Goal

Make ChatGPT/Atlas the control plane for Codex. A user command such as `Codex: fix X` becomes a durable Atlas job. A local Ubuntu worker claims the job, invokes Codex inside an allowlisted repository, captures evidence, and returns a structured result to Atlas.

## Control flow

ChatGPT/Atlas -> Atlas API -> canonical job queue -> atlas-codex local worker -> Codex CLI -> git/tests -> Atlas result/receipt -> ChatGPT.

Google Drive `Atlas Codex To-Do` is a human-readable mirror only. The queue must live in Atlas state.

## Required API contract

- POST `/api/v1/codex/jobs`
- GET `/api/v1/codex/jobs`
- GET `/api/v1/codex/jobs/:id`
- POST `/api/v1/codex/jobs/:id/claim`
- POST `/api/v1/codex/jobs/:id/heartbeat`
- POST `/api/v1/codex/jobs/:id/result`
- POST `/api/v1/codex/jobs/:id/cancel`
- POST `/api/v1/codex/jobs/:id/retry`

## Job states

`queued -> ready -> claimed -> running -> review -> done`

Alternative states: `waiting_approval`, `blocked`, `failed`, `cancelled`.

## Worker requirements

The Ubuntu worker must:

1. authenticate to Atlas API using a separate scoped token;
2. poll with backoff;
3. claim jobs atomically using leases and heartbeat;
4. resolve repo/cwd through an allowlist registry;
5. refuse arbitrary filesystem paths supplied by untrusted job text;
6. invoke Codex through a deterministic wrapper;
7. capture stdout/stderr summaries, git diff, tests, changed files, commit SHA and artifacts;
8. stop at policy approval gates;
9. report structured results to Atlas;
10. recover after reboot/network interruption without duplicate execution.

## Local CLI

Planned commands:

- `atlas-codex health`
- `atlas-codex pull`
- `atlas-codex next`
- `atlas-codex run <job_id>`
- `atlas-codex watch`
- `atlas-codex report <job_id>`
- `atlas-codex sync`
- `atlas-codex doctor`

## Safety baseline

- Repository allowlist only.
- Isolated branch/worktree for write jobs by default.
- No secrets in logs or Drive.
- No destructive database migration, secret rotation, mass email, financial action, publication, or destructive system shell without explicit approval policy.
- Idempotent job creation and result reporting.
- Lease/heartbeat to prevent duplicate workers.
- Every mutation produces an audit record and Action Receipt.

## Environment variables

The worker should consume, at minimum:

- `ATLAS_API_BASE_URL`
- `ATLAS_CODEX_TOKEN`
- `ATLAS_CODEX_WORKER_ID`
- `ATLAS_CODEX_POLL_MS`
- `ATLAS_CODEX_ALLOWED_REPOS`
- `ATLAS_CODEX_DEFAULT_MAX_ATTEMPTS`

Never commit actual credentials.

## Acceptance path

A safe E2E test is complete when:

1. Atlas creates exactly one test job.
2. Ubuntu worker claims it.
3. Codex modifies a disposable test file in an allowlisted repo.
4. Repo-native checks/tests run.
5. Worker returns changed files, diff summary, test result and commit SHA.
6. Atlas marks the job `review` or `done` according to policy.
7. ChatGPT can query the final result without manual copy/paste.

## Implementation order

1. Reuse/extend current Atlas queue/store before creating new tables.
2. Add API job lifecycle endpoints and tests.
3. Add `lib/codex-jobs.js` as the server-side contract layer.
4. Add local `scripts/atlas-codex.js` worker/CLI.
5. Add systemd user-service example.
6. Add E2E fixture and restart/network/idempotency tests.
7. Wire Drive mirror after canonical queue is proven.
