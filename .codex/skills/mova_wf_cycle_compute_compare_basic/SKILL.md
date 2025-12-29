---
name: "MOVA: wf_cycle compute compare (wrapper)"
description: "Runs wf_cycle_compute_compare_basic to diff fresh WF results against baselines."
when_to_use:
  - "Need guardrail evidence that a WF cycle change matches expected baselines"
inputs:
  - kind: json
    schema: "skills/wf_cycle_compute_compare_basic/mova/ds/ds.wf_cycle_compare_request_v1.schema.json"
outputs:
  - kind: json
    schema: "skills/wf_cycle_compute_compare_basic/mova/ds/ds.wf_cycle_compare_result_v1.schema.json"
deterministic: true
---

## Command
`node .codex/skills/mova_wf_cycle_compute_compare_basic/scripts/run.mjs --request <request.json>`

## Notes
- Calls `skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs` and expects repo root CWD.
- Attach diff screenshots/text dumps referenced in the result payload under `attachments`.
- Stop and raise if the CLI exits non-zero; include stderr excerpt with the stored result JSON.
