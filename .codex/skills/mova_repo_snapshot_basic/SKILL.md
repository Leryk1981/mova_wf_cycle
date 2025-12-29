---
name: "MOVA: repo snapshot (wrapper)"
description: "Runs the official repo_snapshot_basic binding to capture code + MOVA memory state."
when_to_use:
  - "Before major planning or governance steps that need a fresh repo artifact bundle"
inputs:
  - kind: json
    schema: "skills/repo_snapshot_basic/mova/ds/ds.repo_snapshot_request_v1.schema.json"
outputs:
  - kind: json
    schema: "skills/repo_snapshot_basic/mova/ds/ds.repo_snapshot_result_v1.schema.json"
  - kind: json
    schema: "skills/repo_snapshot_basic/mova/env/env.repo_snapshot_run_v1.schema.json"
deterministic: true
---

## Command
`node .codex/skills/mova_repo_snapshot_basic/scripts/run.mjs --request <request.json>`

## Notes
- Wrapper forwards into `skills/repo_snapshot_basic/impl/bindings/node/cli.mjs` from repo root.
- Keep request/result/env payloads alongside generated evidence paths referenced inside the env schema.
- Failing runs must surface stderr and mark the env payload with `status: error` before retrying.
