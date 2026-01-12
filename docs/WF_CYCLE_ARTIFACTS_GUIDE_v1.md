# WF cycle artifacts guide (v1)

## Primary locations
- Workflow cycle runs (canonical): `wf_formalization_cycle_v1/runs/<runId>/`
  - Contains `event_log.jsonl`, `metrics.json`, `scorecard.json`, `notes.md`, and `artifacts_snapshot/`.
- Public fixture outputs: `lab/examples/wf_cycle_public_fixture/`
  - Attempts under `attempts/<agent>/wf_cycle/runs/<label>/` mirror the same run layout.
  - Compare outputs: `compare/<label>/` (inputs, metrics, summaries).
  - Winner pack: `outputs/winner_pack_skill/`.
- Pult smoke events: `lab/inngest_runs/<eventId>/` (per handler) with `result.json` and step folders.
- FlashSlot smoke/demo: `lab/flashslot_runs/<runId>/` (experiment_summary.json, winner_pack/).

## Typical run layout
Example: `wf_formalization_cycle_v1/runs/WF_RUN_0001_spiral/`
```
event_log.jsonl        # append-only log; first line META with ts_unit
metrics.json           # computed metrics (E/V/S/IC/TFR, etc.)
scorecard.json         # comparison-friendly snapshot
notes.md               # human notes
artifacts_snapshot/    # copied inputs/outputs used for metrics
```

Compare outputs (fixture): `lab/examples/wf_cycle_public_fixture/compare/B_topdown_skill/`
- Contains the Proof of Invariance artifacts: metrics comparison, `result_core` diffs, and `paths_written` from `compute_compare`.

Winner pack (fixture): `lab/examples/wf_cycle_public_fixture/outputs/winner_pack_skill/`
- Bundles the winning attempt’s event_log, metrics, scorecard, compare summary, and evidence snapshot.

## What to check first
1. `event_log.jsonl` exists, starts with `META(ts_unit)` and includes `ctx` on every line plus `METRICS_CALC`.
2. `metrics.json` matches the latest metrics event in `event_log.jsonl`; IC/source should be consistent.
3. `artifacts_snapshot/` (or equivalent) present and aligns with paths referenced in metrics/scorecard.
4. Compare output (if applicable) names a clear `winner_label` and lists `paths_written` without warnings.
5. Winner pack (if generated) includes the expected run folder and compare summary, with no missing files reported by the packer.
