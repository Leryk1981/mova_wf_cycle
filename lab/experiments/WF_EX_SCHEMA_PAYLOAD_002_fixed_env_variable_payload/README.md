# WF_EX_SCHEMA_PAYLOAD_002 — fixed env / variable payload (summary)

Purpose: validate payload flexibility while keeping execution deterministic and secure.

- Compares three variants: V0 (schema embedded), V1 (schema from registry, fixed env), V2 (inline schema, deny-by-default).
- Uses Cloudflare Worker with schema registry; replaces AJV with `@cfworker/json-schema` to avoid CSP issues.
- Records episodes with payload refs, hashes, compile/validate timings.

Artifacts:
- Deploy/run instructions: see `DEPLOY_INSTRUCTIONS.md` and `PHASE4_RUNBOOK.md`.
- Test evidence and results: `TEST_REPORT_AJV_REPLACEMENT.md`, `RESULTS.md`, and `EVIDENCE_INDEX.md`.
- Contract: `experiment_contract_v1.md`.
