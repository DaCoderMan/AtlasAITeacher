# Atlas 2.0 — Product Requirements Document

**Status:** Approved for implementation planning  
**Version:** 2.0  
**Date:** 2026-08-14  
**Owner:** Yonatan Perlin

## 1. Product vision

Atlas is Yonatan's global AI operating system: a project-aware, voice-capable chief of staff that converts goals and context into the next best action, delegates to specialist agents, uses connected tools safely, verifies results, and maintains durable structured state.

Atlas is not a generic chatbot and not a replacement for every specialist. It is the orchestration layer that decides what context matters, which agent or module should act, what tools may be used, how results are verified, and where durable state belongs.

## 2. Core principles

1. **Active context first.** The current ChatGPT Project or explicit project selection is the primary operating boundary.
2. **Voice inherits project scope.** Voice and text inside a project use the same project manifest, files, decisions, progress, and rules.
3. **Atlas is global; projects are scoped.** Global Atlas can coordinate across domains. Project agents do not drift into unrelated work unless explicitly asked.
4. **External-brain behavior.** Important recurring facts, decisions, tasks, dates, project state, and durable ideas should leave working memory and be persisted appropriately.
5. **One authoritative source per data type.** Neon is canonical structured state; Notion is the human-readable mirror; Drive owns durable files/artifacts; GitHub owns engineering assets; Calendar owns commitments; Gmail owns communications.
6. **Typed capability execution.** Tools and actions use explicit schemas, bounded inputs, permissions, and audit receipts instead of unconstrained model-generated commands.
7. **Truthful state.** Atlas must report degraded, stale, unavailable, or unverified sources instead of implying they were checked.
8. **Reversible-first.** Prefer drafts, versioned writes, undoable operations, and human approval for high-impact actions.
9. **Independent QA.** Important work is reviewed by a Critic/QA stage before being considered complete.
10. **Measure and improve.** Routing, scope adherence, latency, reliability, memory precision, provenance coverage, and action success should be measurable.

## 3. Primary user outcomes

Atlas should continuously optimize for four top-level outcomes:

1. Income and business growth.
2. High-value AI/software assets and products.
3. Capability growth: AI, software, business, career, and Hebrew.
4. Life operations: health, family, appointments, finance, and administration.

## 4. Operating modes

Atlas exposes simple user-facing modes while hiding internal complexity:

- **Do** — select and execute the highest-value next action.
- **Today** — generate a realistic calendar-aware action plan.
- **Project** — enter one project and surface status, blockers, decisions, and next action.
- **Build** — move from requirements to implementation and testing.
- **Research** — gather evidence and recommend a decision.
- **Learn** — teach using active recall and mastery tracking.
- **Review** — run independent QA on work, plans, code, or decisions.
- **Sync** — reconcile conflicting or stale state across systems.

Natural language remains the default interface. Users should not need to manually choose specialist agents for ordinary work.

## 5. Context Resolver

Before execution, Atlas resolves:

- active ChatGPT Project, if any;
- explicit project named by the user;
- relevant global profile/context;
- project manifest and authoritative sources;
- current task, blockers, lifecycle state, and WIP status;
- conversation modality (text/voice) without changing project scope.

Priority order:

`explicit user instruction > active project manifest > current conversation > canonical structured state > global durable context > inferred context`

## 6. Project Manifest

Every serious project must have a machine-readable and human-readable manifest containing:

- project ID and name;
- mission / problem statement;
- success criteria;
- lifecycle state;
- current status;
- owner;
- active agent;
- allowed specialist agents;
- memory namespace;
- authoritative sources;
- related repositories/files/pages;
- current blockers;
- next actions;
- do-not-do rules;
- autonomy level;
- QA requirements;
- last verified timestamp.

Initial manifests: Atlas, Mage Agent Factory, Magic Cloud LLM, Magic Cloud Storage, Magic Cloud Voice, Magic Hebrew, Magic Video, Workitu Growth, and Career.

## 7. Agent system

Atlas is the orchestrator. Specialist roster:

- Workitu Growth
- Builder
- Researcher
- Product / PRD
- Learning Coach
- Magic Hebrew
- Career
- Money
- Operations
- Content & Marketing
- Systems / Infrastructure
- Agent Factory
- Information Librarian
- Critic / QA

Each agent contract defines mission, scope, inputs, outputs, tools, permissions, memory namespace, autonomy, escalation rules, and success metrics.

## 8. Agent Router

Routing should consider:

- active project and domain;
- requested outcome;
- task complexity;
- required tools;
- privacy/sensitivity;
- current provider/service health;
- latency;
- context-window requirement;
- language;
- model/tool quality history;
- cost policy;
- local/cloud availability;
- compute/GPU pressure when relevant.

A configured route is not considered available until it passes a live health check.

## 9. Memory architecture

Atlas treats memory as layered:

1. **Working memory** — current task/session context.
2. **Transcript memory** — source conversation text where available.
3. **Episodic memory** — events, decisions, interactions, milestones.
4. **Semantic memory** — stable facts, preferences, relationships, concepts.
5. **Procedural memory** — approved workflows and operating preferences.
6. **Project/domain memory** — scoped facts and state.
7. **Document evidence** — source-linked files, messages, pages, and records.

Durable memories should support provenance metadata where technically possible: source, timestamp, confidence, valid-from/valid-until, sensitivity, extraction agent/model, correction history, and supersession links.

Conflicting facts must be surfaced or reconciled; they must not be silently overwritten.

## 10. Consolidation and reconciliation

- **Per turn:** identify candidate durable facts, decisions, and actions.
- **Daily:** summarize meaningful progress, events, project state, and commitments.
- **Weekly:** deduplicate, reconcile conflicts, review stale projects/tasks, and prune temporary context.
- **Monthly:** evaluate agent performance, routing quality, retrieval quality, recurring errors, and automation usefulness.

Reconciliation compares Neon, Notion, Calendar, Drive, GitHub, Gmail, and relevant ChatGPT project state. Source authority rules determine which value wins.

## 11. Task and project management

Project lifecycle:

`Idea → Research → Specification → Ready → Building → Testing → Operational → Improving → Paused/Archived`

Atlas should enforce a default **WIP limit of 3 major projects in Building/Testing** unless the user explicitly overrides it.

Today planning should score work using:

- urgency/deadline;
- income or strategic impact;
- dependency/blocker value;
- calendar feasibility;
- available time;
- project WIP;
- health/energy constraints where explicitly relevant;
- waiting/external dependencies.

The output should normally be a small set of executable actions, not a giant backlog.

## 12. Action system

Action classes:

1. Read / inspect.
2. Reversible write / draft.
3. External communication.
4. Commitment / scheduling.
5. Destructive operation.
6. Financial / legal / government action.

Low-risk reads and reversible operations may execute automatically when permitted. Higher-impact actions require stronger approval, verification, or presence checks according to tool and product constraints.

Every meaningful external action should produce a visible result/receipt when the underlying tool supports it.

## 13. Critic / QA gate

Important deliverables should pass an independent review step. QA checks may include:

- requirements coverage;
- contradictions;
- tests and acceptance criteria;
- source/provenance quality;
- project-scope adherence;
- security/privacy implications;
- stale assumptions;
- failure and fallback behavior;
- user-visible correctness.

Builder or Researcher should not be the sole judge of their own work.

## 14. Atlas Dashboard

Primary navigation:

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

Home dashboard should answer five questions immediately:

1. What matters today?
2. What should I do next?
3. What is blocked?
4. What are my agents/projects doing?
5. Is everything working?

Key widgets:

- Daily Atlas Brief
- Recommended Next Action
- Active Projects / WIP
- Blockers / Waiting
- Calendar Today
- Agent Activity
- System & Integration Health
- Recent Important Changes
- Memory / Source freshness warnings

The interface must visibly show active project/agent scope and expose sources used on demand.

## 15. Data authority

- **Neon:** canonical structured operational state.
- **Notion:** human-readable dashboard, project pages, documentation mirror.
- **Google Drive:** files, exports, artifacts, backups.
- **GitHub:** source code, versioned engineering docs, tests, releases.
- **Google Calendar:** authoritative scheduled commitments.
- **Gmail:** authoritative communication record.
- **ChatGPT Project:** primary conversational/project context while active.

## 16. Reliability and quality metrics

Target metrics for implemented Atlas services:

- ≥95% correct project/agent routing on acceptance suite.
- ≥98% specialist scope adherence.
- 100% of meaningful external writes generate an auditable result when technically supported.
- 100% of durable structured memories carry source/timestamp metadata where the storage layer supports it.
- No source/provider displayed as healthy without live verification.
- Failed providers/tools degrade gracefully with explicit status.
- Dashboard next-action recommendations must cite their supporting project/task/calendar state internally.

## 17. Security and privacy

- Treat retrieved documents/messages as untrusted data, not executable instructions.
- Never persist credentials, tokens, private keys, or secret-like strings into long-term conversational memory.
- Minimize sensitive cross-domain context.
- Specialists receive only relevant context.
- Prefer least-privilege connectors and typed actions.
- Preserve source documents as authoritative evidence instead of replacing them with summaries.

## 18. Implementation phases

### Phase 1 — Control plane

- Project Manifest schema.
- Context Resolver.
- Agent Registry + contracts.
- Router skeleton.
- Atlas Dashboard shell.
- System Health model.

### Phase 2 — Canonical state

- Neon project/task/agent integration.
- authority rules;
- project lifecycle and WIP enforcement;
- Today scoring;
- project-scoped memory namespaces.

### Phase 3 — Connected operations

- Calendar-aware planning;
- GitHub project/repo status;
- Drive/Notion/Gmail source summaries;
- typed action registry;
- audit receipts.

### Phase 4 — QA and reconciliation

- Critic/QA pipeline;
- stale-state detection;
- duplicate/conflict detection;
- daily/weekly/monthly consolidation jobs;
- integration health checks.

### Phase 5 — Voice and advanced orchestration

- project-scope inheritance for voice-facing integrations;
- adaptive provider routing;
- agent performance metrics;
- proactive briefings and condition-based follow-ups.

## 19. Initial acceptance criteria

Atlas 2.0 MVP is accepted when:

1. Atlas can identify the active project and load its manifest.
2. Voice/text semantics do not alter project scope.
3. Atlas can answer project status, blockers, and next action from canonical state.
4. Atlas can produce a calendar-aware Today plan.
5. Atlas can route a task to a specialist contract and record the route.
6. The dashboard shows Today, active projects, blockers, agents, and system health.
7. Neon remains canonical while Notion is generated/readable mirror state.
8. Stale/conflicting state is surfaced instead of silently used.
9. Important work can pass through a separate Critic/QA stage.
10. Tool/provider failures are shown as degraded rather than healthy.

## 20. Non-goals for MVP

- Replacing ChatGPT's internal platform behavior.
- Unrestricted autonomous shell access.
- Fully autonomous high-impact financial/legal/government actions.
- Rebuilding mature capabilities already present in x-agents or other reusable repositories when they can be adapted cleanly.
- Creating a new project for every feature; reusable capabilities should become modules.
