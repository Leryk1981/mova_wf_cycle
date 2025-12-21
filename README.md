# MOVA wf_cycle standalone

Deterministic workflow factory for MOVA wf_cycle plus a local Inngest-based control plane ("pult") for running smoke/full/experiment flows without SaaS dependencies.

What it is not: no hosted services, no background AI runtime — all executions stay local and deterministic.

## Quickstart

1. npm ci
2. npm run smoke:wf_cycle
3. npm run smoke:pult

Artifacts land in lab/inngest_runs/<event.id>/...; inspect stdout/stderr/result.json per step to debug. MOVA language/context references live in MOVA_CONTEXT_PACK.md.

## FlashSlot Demo (A/B/C)

Run the committed dentist A/B/C hypothesis set end-to-end (noop driver + dry-run) with a single command:

```
npm ci && npm run demo:flashslot
```

Inspect artifacts at:
- lab/flashslot_runs/<runId>/experiment_summary.json
- lab/flashslot_runs/<runId>/winner_pack/
