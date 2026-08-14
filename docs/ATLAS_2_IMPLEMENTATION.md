# Atlas 2.0 — Codex Implementation Roadmap

## Objective

Implement Atlas 2.0 incrementally inside the existing `DaCoderMan/AtlasAITeacher` repository. Do not create a second Atlas application and do not rewrite working Project X / Memory Gateway behavior unless required by tests.

## Working rules for Codex

1. Read `AGENTS.md`, `docs/PROJECT_MANIFEST.md`, `docs/ATLAS_2_PRD.md`, and `docs/ATLAS_2_ARCHITECTURE.md` before implementation.
2. Inventory existing `api/`, `lib/`, Vercel functions, environment variables, and Neon/Notion integrations before adding abstractions.
3. Prefer small vertical slices with tests over large rewrites.
4. Reuse compatible ideas/modules from `x-agents`, `xlife-life-os`, `workitu-brain`, and `businessbrain` only after inspection; do not couple Atlas to those repositories at runtime unless explicitly designed.
5. Never commit secrets or personal database contents.
6. All health indicators must be truthful: `unknown` is different from `healthy`.
7. Preserve Neon as canonical structured state and Notion as a generated/human-readable mirror.
8. Project scope must be explicit and testable.

## Phase 0 — Inventory and baseline

Deliverables:
- `docs/CURRENT_SYSTEM_INVENTORY.md`
- current API routes and data flows;
- current Neon tables/queries used;
- current Notion writes;
- existing tests and gaps;
- environment-variable inventory without secret values;
- baseline smoke test.

Acceptance:
- existing Project X sync behavior still works;
- no secrets exposed;
- architecture gaps are documented before refactor.

## Phase 1 — Project Manifest v1

Implement:
- manifest schema validation;
- manifest loader;
- registry of initial projects;
- project lookup by ID/slug/name;
- last-verified metadata.

Initial manifests:
- Atlas
- Mage Agent Factory
- Magic Cloud LLM
- Magic Cloud Storage
- Magic Cloud Voice
- Magic Hebrew
- Magic Video
- Workitu Growth
- Career

Recommended files:

```text
lib/manifests/schema.*
lib/manifests/registry.*
config/manifests/*.yaml|json
```

Tests:
- valid manifests load;
- invalid lifecycle rejected;
- unknown project handled explicitly;
- duplicate IDs rejected.

## Phase 2 — Context Resolver

Implement a pure/testable resolver that receives available context and returns a normalized `ResolvedContext`.

Required precedence:

`explicit user project > active project > conversation context > canonical state > global context`

Required behavior:
- modality does not change scope;
- project memory namespace is resolved;
- allowed agents and authoritative sources come from manifest;
- missing verification timestamps are surfaced.

Tests:
- Magic Hebrew + voice remains Magic Hebrew scope;
- global Atlas request remains global;
- explicit project overrides inferred project;
- unrelated global context does not override project constraints.

## Phase 3 — Agent Registry v1

Implement machine-readable agent contracts for:
- Atlas
- Workitu Growth
- Builder
- Researcher
- Product/PRD
- Learning Coach
- Magic Hebrew
- Career
- Money
- Operations
- Content & Marketing
- Systems/Infrastructure
- Agent Factory
- Information Librarian
- Critic/QA

Router output should identify agent(s) and rationale metadata without exposing hidden reasoning.

Tests:
- project allowed-agent restrictions;
- out-of-scope specialist request returns to Atlas/router;
- Critic/QA is distinct from Builder.

## Phase 4 — System Health registry

Create normalized connector/provider health objects:

```text
healthy | degraded | offline | unknown
```

Track:
- service ID;
- category;
- last checked;
- latency when available;
- failure summary;
- capabilities.

Initial services:
- Neon
- Notion
- Drive
- GitHub
- Calendar
- Gmail
- model/provider registry
- voice services when connected

Rule: configuration does not imply health.

## Phase 5 — Router v1

Build deterministic-first routing.

Inputs:
- `ResolvedContext`
- intent/mode
- capability requirements
- risk
- language
- service health

Output:
- selected agent(s)
- workflow type
- required capabilities
- QA requirement
- degraded-state warnings.

Do not implement complex learned routing yet. Start with explicit rules and test cases; make future scoring pluggable.

## Phase 6 — Today Engine v1

Create a pure ranking engine over canonical tasks/projects/calendar commitments.

Start with configurable scoring components:
- urgency;
- project priority;
- income/strategic impact;
- blocker release;
- dependency value;
- calendar fit;
- WIP penalty;
- waiting penalty;
- context-switch penalty.

Output:
- one recommended next action;
- up to four additional actions;
- calendar commitments;
- blockers/warnings.

Every recommendation must carry machine-readable evidence IDs so the UI can explain why it was selected.

## Phase 7 — Reconciliation v1

Implement reconciliation as proposals first, then safe auto-resolution for deterministic cases.

Entities:
- projects;
- tasks;
- integration health;
- repository links;
- calendar linkage.

Conflict record should include:
- entity;
- competing values;
- sources;
- freshness;
- authority ranking;
- proposed canonical value;
- resolution status.

Never destroy source history.

## Phase 8 — Critic / QA v1

Create an independent QA interface.

Initial QA types:
- requirements coverage;
- scope adherence;
- source freshness;
- test result check;
- contradiction check;
- degraded dependency check.

QA returns `pass`, `pass_with_notes`, or `fail` plus structured findings.

## Phase 9 — Atlas Dashboard MVP

Use the Business Brain information hierarchy as inspiration, adapted to Atlas.

Pages:
- Today
- Projects
- Brain
- Agents
- Workitu
- Career
- Learn
- Knowledge
- Automations
- System Health

MVP Home widgets:
1. Daily Atlas Brief
2. Recommended Next Action
3. Active WIP Projects
4. Blockers / Waiting
5. Today's Calendar
6. Agent status/activity
7. System Health
8. Important recent changes

Do not use placeholder claims such as “4 agents active” unless backed by state.

## Phase 10 — Acceptance suite

Create fixtures and tests for these scenarios:

1. User inside Magic Hebrew project asks by voice to practice Portuguese→Hebrew flow.
2. User inside Magic Hebrew asks an unrelated Agent Factory architecture question.
3. Global user asks “what should I do next?” with tasks + calendar + blockers.
4. Neon says a task is pending while fresher verified evidence says completed.
5. GitHub unavailable during project status check.
6. Builder finishes implementation but QA detects missing acceptance criterion.
7. Provider configured but health unknown.
8. WIP already has three major builds and a fourth is proposed.
9. Calendar commitment conflicts with a planned task block.
10. Project manifest restricts agent/tool access.

## First Codex task

Start with **Phase 0 + Phase 1 only**.

Expected first implementation PR/commit should:
- document existing Atlas repo behavior;
- add tested Project Manifest schema/registry;
- add the nine initial manifest records;
- avoid changing production sync behavior;
- include a short migration plan for connecting manifests to Neon later.

Do not proceed into Dashboard work until manifest tests pass.

## Definition of done for Atlas 2.0 MVP

Atlas 2.0 MVP is done only when the following is demonstrated by tests or live checks:
- project scope resolution works;
- project manifests are authoritative configuration;
- agents are explicit contracts;
- service health is truthful;
- Today ranking is explainable;
- stale/conflicting state is detected;
- QA is independent;
- dashboard is backed by real state;
- existing Project X/Neon→Notion functionality remains operational.
