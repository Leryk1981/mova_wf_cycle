---
name: "MOVA: wf_cycle winner pack (wrapper)"
description: "Builds the wf_cycle_winner_pack_basic deliverable bundle via the official binding."
when_to_use:
  - "Publishing or reviewing the winning WF cycle artifact pack"
inputs:
  - kind: json
    schema: "skills/wf_cycle_winner_pack_basic/mova/ds/ds.wf_cycle_winner_pack_request_v1.schema.json"
outputs:
  - kind: json
    schema: "skills/wf_cycle_winner_pack_basic/mova/ds/ds.wf_cycle_winner_pack_result_v1.schema.json"
deterministic: true
---

## Command
`node .codex/skills/mova_wf_cycle_winner_pack_basic/scripts/run.mjs --request <request.json>`

## Notes
- Delegates to `skills/wf_cycle_winner_pack_basic/impl/bindings/node/build_winner_pack.mjs`; ensure repo root CWD.
- Store generated archives/screens in paths referenced by the result schema `artifacts` block.
- Copy any instructional CLI text into the `notes` array within the result for downstream traceability.
