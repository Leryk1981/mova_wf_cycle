# Repository inventory — wf_cycle (v1)

## Top-level layout
- `core/` — MOVA core schemas and vocab (read-only).
- `docs/` — human-facing docs (guides, snapshots, project memory).
- `lab/` — skills registry, examples, experiments, smoke artifacts (`flashslot_runs/`, `inngest_runs/`).
- `packs/` — packaged runtimes (e.g., `flashslot_v0`).
- `pults/` — Inngest control-plane code for wf_cycle (`inngest_wf_cycle_v0`).
- `skills/` — MOVA skills (wf_cycle compute/compare/winner_pack, ingest, cleanup, etc.).
- `tools/` — CLI utilities and smoke runners.
- `wf_formalization_cycle_v1/` — canonical workflow cycle runs and templates.

## Key commands
- Validation/tests: `npm run validate`, `npm test`.
- Smoke flows: `npm run smoke:wf_cycle`, `npm run smoke:flashslot`, `PULT_SMOKE_ENABLE=1 npm run smoke:pult` (pult skips by default).

## Artifact hotspots
- Workflow cycle runs: `wf_formalization_cycle_v1/runs/<id>/` (event_log.jsonl, metrics.json, scorecard.json, artifacts_snapshot/).
- FlashSlot: `lab/flashslot_runs/<runId>/`.
- Pult events: `lab/inngest_runs/<eventId>/` (handler outputs).
- Winner pack fixture: `lab/examples/wf_cycle_public_fixture/outputs/winner_pack_skill/`.

## References
- Artifact guide: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`.
- Pult runtime notes: `PULT_INNGEST_V0.md`.
