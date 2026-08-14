# Atlas 2.0 — Architecture

## System overview

```text
Yonatan
  │
  ▼
Active Context Resolver
  │
  ├─ ChatGPT Project / explicit project
  ├─ Project Manifest
  ├─ Current conversation
  └─ Global durable context
  │
  ▼
Atlas Orchestrator
  │
  ├─ Intent / Mode Resolver
  ├─ Project & WIP Controller
  ├─ Agent Router
  ├─ Provider / Model Router
  └─ Plan / Workflow Engine
  │
  ▼
Specialist Agent(s)
  │
  ▼
Typed Capability Registry
  │
  ├─ Neon
  ├─ Notion
  ├─ Drive
  ├─ GitHub
  ├─ Calendar
  ├─ Gmail
  └─ local/cloud modules
  │
  ▼
Critic / QA
  │
  ▼
Result + Audit Receipt
  │
  ▼
Persistence / Reconciliation
```

## 1. Context Resolver

The Context Resolver is the first stage of every serious request.

Inputs:
- explicit project named by user;
- active project metadata, when available;
- current conversation;
- project manifest;
- global context relevant to the request.

Output contract:

```json
{
  "scope": "global|project",
  "project_id": "optional",
  "project_name": "optional",
  "mode": "do|today|project|build|research|learn|review|sync|general",
  "memory_namespace": "global/* or projects/<slug>/*",
  "allowed_agents": [],
  "authoritative_sources": [],
  "constraints": [],
  "last_verified_at": "timestamp"
}
```

The resolver must never infer that voice changes scope. Voice uses the same resolved context as text.

## 2. Project Manifest Registry

Manifests are versioned configuration, not free-form notes.

Recommended representation:

```yaml
id: atlas
name: Atlas
mission: Global AI operating system and orchestrator
lifecycle: building
priority: P0
agent: atlas
memory_namespace: projects/atlas
success_criteria: []
authoritative_sources:
  structured: neon
  docs: notion
  engineering: github:DaCoderMan/AtlasAITeacher
related_projects: []
blockers: []
next_actions: []
autonomy: medium
qa_required: true
wip_class: major
last_verified_at: 2026-08-14T00:00:00+03:00
```

Manifest storage should eventually be canonical in Neon and optionally mirrored to GitHub/Notion for human review.

## 3. Atlas Orchestrator

Atlas is a control plane, not a monolithic prompt.

Responsibilities:
- resolve user intent and operating mode;
- determine active project scope;
- inspect lifecycle, blockers, dependencies, and WIP;
- choose one or more specialist agents;
- choose workflow shape;
- coordinate tools/modules;
- request independent QA where needed;
- reconcile result into canonical state;
- produce concise user-facing output.

Atlas should avoid doing specialist work itself when a dedicated agent contract exists and delegation improves quality or reliability.

## 4. Agent contracts

Each agent is represented as data/config plus implementation.

```yaml
id: researcher
mission: Produce current evidence-based analysis
scope: research and decision support
inputs:
  - question
  - constraints
outputs:
  - findings
  - recommendation
  - uncertainty
allowed_tools:
  - web
  - drive-read
  - github-read
memory_namespace: agents/researcher
risk_ceiling: medium
qa_policy: external-review-for-high-impact
success_metrics:
  - source_quality
  - factual_accuracy
  - decision_usefulness
```

The router should read contracts rather than relying only on prompt text.

## 5. Routing layers

### Agent routing

Inputs:
- project manifest;
- domain;
- intent;
- required capabilities;
- risk;
- language;
- specialist scope.

### Provider/model routing

Inputs:
- task complexity;
- tool support;
- privacy;
- latency;
- provider health;
- context window;
- historical quality;
- subscription/cost policy;
- local GPU pressure.

Provider records:

```json
{
  "id": "provider-id",
  "type": "local|subscription|api",
  "capabilities": ["text", "tools"],
  "languages": ["pt", "en", "he"],
  "health": "healthy|degraded|offline|unknown",
  "last_health_check": "timestamp",
  "latency_ms_p50": 0,
  "quality_score": null,
  "privacy_class": "local|external"
}
```

Unknown health must not be treated as healthy.

## 6. Typed Capability Registry

All external operations are capabilities with schemas.

```yaml
id: calendar.create_event
class: commitment
risk: medium
reversible: true
requires:
  - calendar_connection
inputs:
  title: string
  start: datetime
  end: datetime
  timezone: string
output:
  event_id: string
  receipt: object
```

Capability metadata includes:
- read/write class;
- risk;
- reversibility;
- permission requirements;
- idempotency strategy;
- approval policy;
- audit policy;
- timeout/fallback.

## 7. Memory service

Recommended logical objects:

```text
memory_item
├─ id
├─ namespace
├─ type: episodic|semantic|procedural|project
├─ content
├─ source_uri
├─ source_excerpt/location
├─ confidence
├─ sensitivity
├─ valid_from / valid_until
├─ created_at / verified_at
├─ supersedes / superseded_by
└─ metadata
```

Retrieval order should favor:
1. active-project direct evidence;
2. current canonical structured state;
3. high-confidence current memories;
4. supporting documents/messages;
5. older or inferred state.

Sensitive cross-domain retrieval should be minimized.

## 8. Reconciliation engine

The reconciliation engine compares records representing the same entity across systems.

Example conflict:

```text
Neon task: "Install RTX 3070" = pending
Recent evidence: RTX 3070 installed
```

Process:
1. identify entity/link;
2. collect source states;
3. rank authority and freshness;
4. auto-resolve deterministic low-risk conflict or surface it;
5. write canonical state;
6. update mirrors;
7. log reconciliation.

Never overwrite historical evidence merely because canonical state changes.

## 9. Today engine

Candidate task score:

```text
score =
  urgency
+ strategic_impact
+ income_impact
+ blocker_release
+ dependency_value
+ calendar_fit
+ project_priority
- waiting_penalty
- context_switch_penalty
- WIP_penalty
```

The exact weighting should be configurable and later evaluated against user corrections.

Output should include:
- top 1 next action;
- 2–4 additional actions;
- appointments/commitments;
- blocked/waiting items only when relevant.

## 10. Critic / QA

QA receives the artifact plus requirements, not the Builder's hidden reasoning.

QA result:

```json
{
  "status": "pass|pass_with_notes|fail",
  "requirements_coverage": 0.0,
  "issues": [],
  "tests_checked": [],
  "source_quality": null,
  "scope_adherence": true,
  "recommended_next_action": ""
}
```

Important state transitions from Testing → Operational should normally require QA pass.

## 11. Dashboard architecture

The dashboard is a projection of canonical state; it is not another database.

### Home
- Daily Atlas Brief
- Recommended Next Action
- Active WIP projects
- blockers/waiting
- calendar today
- system health
- meaningful changes

### Project view
- mission
- lifecycle
- progress/status
- latest decisions
- blockers
- next action
- repository/docs
- relevant agent
- source freshness

### Agent view
- agent roster
- mission/scope
- status
- current assignment
- success metrics
- last activity

### System Health
- Neon
- Notion
- Drive
- GitHub
- Calendar
- Gmail
- model/providers
- voice services
- scheduled sync/reconciliation

Health statuses: healthy, degraded, offline, unknown.

## 12. Suggested repository layout

```text
AtlasAITeacher/
├─ api/
├─ docs/
│  ├─ ATLAS_2_PRD.md
│  ├─ ATLAS_2_ARCHITECTURE.md
│  └─ ATLAS_2_IMPLEMENTATION.md
├─ lib/
│  ├─ context/
│  ├─ manifests/
│  ├─ agents/
│  ├─ routing/
│  ├─ capabilities/
│  ├─ memory/
│  ├─ reconciliation/
│  ├─ today/
│  ├─ qa/
│  └─ health/
├─ config/
│  ├─ agents/
│  ├─ manifests/
│  └─ providers/
├─ tests/
│  ├─ routing/
│  ├─ scope/
│  ├─ reconciliation/
│  └─ acceptance/
└─ web/
   └─ dashboard/
```

## 13. Reuse strategy

Do not rebuild mature functionality without inspection.

Potential donor repositories:
- `x-agents`: provider registry, health-aware routing, provenance memory, typed tools, service health, local/cloud fallback.
- `xlife-life-os`: domain/module/gateway/scheduler patterns.
- `workitu-brain`: daily briefs, Google source aggregation, service monitoring.
- `businessbrain`: dashboard interaction and visual information hierarchy.
- `Life-OS-1982`: external-brain filing/review principles.

Reuse must be selective: copy architecture or tested modules only after compatibility/security review.

## 14. Key architectural rule

**Atlas owns orchestration and state coordination. Mage Agent Factory owns reusable agent assembly. Magic Cloud modules provide interchangeable capabilities. Specialist agents own domain execution.**

This boundary should prevent Atlas from becoming another monolith.
