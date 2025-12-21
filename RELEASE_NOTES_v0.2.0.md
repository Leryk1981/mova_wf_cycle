# mova_wf_cycle v0.2.0

- FlashSlot operator demo pack (dentist A/B/C) with deterministic experiment runner that keeps artifacts for every attempt and winning pack.
- `demo:flashslot` one-command script runs the committed dentist set with a noop driver + dry-run to showcase the workflow and artifacts.
- CI gate now exercises the FlashSlot experiment smoke to pin regressions.
- Version bump to align with the new demo + experiment coverage.

## How to run locally
- `npm ci`
- `npm run demo:flashslot`
- `npm run smoke:flashslot:experiment`

Artifacts land under `lab/flashslot_runs/<runId>/experiment_summary.json` and `lab/flashslot_runs/<runId>/winner_pack/`.
