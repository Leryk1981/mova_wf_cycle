# SmartLink 4.1.1 — observability context

This note outlines what to track while running SmartLink 4.1.1 workflow experiments.

## Observability focus
- Track health of the worker and gateway endpoints used by SmartLink scenarios.
- Record experiment IDs, run IDs, and mapping to candidate directories.
- Keep request/response payloads for validation and replay.

## Baseline artifacts
- Baseline SmartLink assets live in `lab/experiments/smartlink_baseline/`.
- Historical Codex candidate lives in `lab/experiments/smartlink_codex_candidate/`.
- Current candidate for WF_EX_010: `lab/experiments/smartlink_4_1_1_candidate_ex010/`.

## What to collect per run
- Status of gateway/worker smoke checks.
- Snapshots of envelopes and schema refs used in the run.
- Metrics relevant to SmartLink (latency, validation outcomes, cache hits if applicable).
- Episode references stored under `lab/` and `docs/PROJECT_MEMORY/`.

## Notes
- Do not mutate the baseline or historical candidates.
- Align all changes with the MOVA 4.1.1 spec snapshot under `spec/mova-spec-4.1.1/`.
