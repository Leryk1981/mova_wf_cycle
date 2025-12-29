# Codex agent guide

## Codex skill policy
- Prefer `.codex/skills/mova_*` wrappers when invoking MOVA skills so Codex executions stay deterministic and scriptable.
- Operational outputs must follow the JSON schemas referenced inside each wrapper (`skills/*/mova/ds` or `skills/*/mova/env`).
- Evidence artifacts (logs, attachments, bundles) belong under `artifacts/…` paths linked from the env/result payloads.
- Use the `mova_run_gates` wrapper (or `npm run codex:wrappers:gen && npm run codex:wrappers:check` before merges) to verify validation/test/smoke gates.
