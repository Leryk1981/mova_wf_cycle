# SmartLink 4.1.1 — context for WF_LAB_SMARTLINK_4_1_1_XX / WF_EX_010

## Purpose
- Bring SmartLink to a “best-so-far” state under MOVA 4.1.1 without touching the 4.0.0 red core while clearly comparing baseline vs new candidates.
- Describe where the baseline, historical Codex candidate, new 4.1.1 folders, and entry points (WF episodes, snapshots) live.

## Versions & spec references
- Skills Lab core: `core/mova/` — MOVA **4.0.0** (read-only for this series).
- Read-only MOVA **4.1.1** spec snapshot: `spec/mova-spec-4.1.1/` (security layer, operator frame, text channels, global catalogs).
- Starting artifacts for the 4.1.1 series:
  - Project snapshot: `docs/PROJECT_MEMORY/PROJECT_SNAPSHOT_2025-12-11_smartlink_4_1_1_lab_entry.md`
  - WF episode: `docs/PROJECT_MEMORY/WF_LAB_SMARTLINK_4_1_1_01_START.md`

## Experiments layout (SmartLink)
- `lab/experiments/smartlink_baseline/` — stable SmartLink baseline; main content in `mova_smartlink/schemas/` (rules, default envelope, global/meta).
- `lab/experiments/smartlink_codex_candidate/` — historical Codex candidate v1 with `config/`, `src/`, `tests/`.
- `lab/experiments/smartlink_4_1_1_candidate_ex010/` — new MOVA 4.1.1 candidate for WF_EX_010 (structure is ready; files get copied here).
- Baseline and Codex candidate stay read-only; all edits go to the 4.1.1 candidate directory.

## Plan for 4.1.1 experiments
- WF_LAB_SMARTLINK_4_1_1_XX — lab episodes for this series.
- First domain experiment: `WF_EX_010_smartlink_4_1_1_baseline_vs_mova` compares the baseline against the MOVA 4.1.1 candidate.
- Each WF_EX has a config (`ds.lab_workflow_experiment_config_v1.*`), a dedicated candidate folder in `lab/experiments/`, and results/episodes under `lab/` plus `docs/PROJECT_MEMORY/`.
- WF_EX_010 config: `lab/examples/ds.lab_workflow_experiment_config_v1.WF_EX_010_smartlink_4_1_1_baseline_vs_mova.json`.
- WF_EX_010 candidate: `lab/experiments/smartlink_4_1_1_candidate_ex010/`.

## Constraints
- Do not edit `core/mova/` (MOVA 4.0.0).
- `spec/mova-spec-4.1.1/` is read-only but acts as the rulebook for SmartLink 4.1.1 adaptation.
- Baseline `lab/experiments/smartlink_baseline/` and historical Codex candidate `lab/experiments/smartlink_codex_candidate/` stay untouched; only use them as references.
- All SmartLink 4.1.1 work lives in `lab/experiments/smartlink_4_1_1_candidate_ex010/`.

## WF_EX_010 candidate directory
- Path: `lab/experiments/smartlink_4_1_1_candidate_ex010/`.
- Purpose: first MOVA 4.1.1 candidate (v2 relative to the old Codex candidate while aligning to spec 4.1.1).
- Usage: copy/update schemas/envelopes/worker code here per MOVA 4.1.1; baseline and historical candidate remain unchanged.
- Related references: baseline at `lab/experiments/smartlink_baseline/`, historical candidate at `lab/experiments/smartlink_codex_candidate/`.
