# Atlas Learning Arcade

Canonical runtime module for Atlas educational games.

## Core behavior

Every game uses persistent per-user state. Progress is saved after every round, including XP, mastery, mission/level, choices/results, error tags and the exact resume point. `N` means Next: advance to the next challenge while preserving state.

Learning quality rules:
- active recall and retrieval practice;
- spaced repetition and due-review scheduling;
- adaptive difficulty;
- confidence calibration;
- Error Bank / misconception tracking;
- Transfer Score for novel scenarios;
- teach-back when useful;
- boss battles and real-world quests;
- randomize/balance multiple-choice correct-answer positions;
- never make option length a reliable correctness cue;
- dynamic state must come from canonical storage, not baked artwork.

## Certification tracks

Certification games may be long-running and are not constrained by the normal short-game duration or 1,000-XP convention. Certification readiness is based on domain mastery, transfer, error profile and repeated realistic mock performance rather than XP alone.

Current certification tracks:
- AWS Architect Quest — SAA-C03
- NVIDIA GenAI Quest — NCA-GENL

## Productivity track

Atlas Productivity Architect teaches planning, prioritization, time/energy/attention management, efficacy vs efficiency, WIP limits, Finish → Replace, batching, time blocking, deep work, capture/triage, delegation, and when to use manual work, checklists, workflows, pipelines, automations or agents. Its final quest produces a functional Personal/Workitu/Atlas Operating System.

## Persistence contract

Operational source of truth is Neon/PostgreSQL using the `atlas_games`, `atlas_game_progress`, `atlas_game_domain_mastery`, `atlas_game_rounds`, `atlas_game_assets`, and `atlas_game_pipeline_versions` tables. Existing `atlas_learning_items`, `atlas_memory_state`, `atlas_review_events`, and `atlas_misconceptions` remain reusable cognitive-learning primitives.

GitHub stores executable code, migrations and versioned specs. Google Drive is the human-readable/master-backup layer. Large image binaries should not bloat the core Git repository; store them in Drive/object storage and register URIs/checksums in `atlas_game_assets`.

## Catalog

The machine-readable catalog is `config/learning_arcade.json`. A game must have a unique slug, clear learning objective, state contract and graphics mapping before production release.
