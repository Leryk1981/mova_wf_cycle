# MOVA wf_cycle standalone
Українська версія: README.uk.md

## Status & purpose
- Deterministic workflow factory for MOVA wf_cycle with a local Inngest-based control plane (“pult”) for smoke/full/experiment runs without SaaS dependencies.
- No hosted services, no background AI runtime — executions stay local and reproducible.
- MOVA language/context references live in `MOVA_CONTEXT_PACK.md`.

## Runtime requirements
- Node.js `22.16.x` (per `engines` and `.nvmrc`); npm `11.6.x` (ships with the required Node line).
- One way with `nvm`:
  1. `nvm install 22.16.0`
  2. `nvm use 22.16.0`
  3. `corepack enable` (keeps npm aligned with the pinned `packageManager`)

## Quickstart
1. `npm ci`
2. `npm run smoke:wf_cycle`
3. `npm run smoke:flashslot`
4. Optional: `PULT_SMOKE_ENABLE=1 npm run smoke:pult` (skips by default unless explicitly enabled; see gates)

## Gates / smoke commands
- `npm run validate` — schema/manifest validation for the skills lab.
- `npm test` — validation plus unit checks for ingest, bootstrap, file-cleanup skills.
- `npm run smoke:wf_cycle` — deterministic wf_cycle scaffold → probes → compare → winner_pack pipeline.
- `npm run smoke:flashslot` — FlashSlot experiment smoke (winner pack + summary).
- `npm run smoke:pult` — runs pult handlers locally (express + inngest stub, inngest-cli dev tunnel) and triggers wf_cycle/full/experiment + flashslot flows. **Default SKIP** to avoid network-heavy setup; set `PULT_SMOKE_ENABLE=1` and install dev deps (`express@5.2.1`, `inngest@3.48.1`, `inngest-cli@1.15.1`) before running.

## Where artifacts live
- wf_cycle: `lab/wf_cycle_runs/<runId>/` and `lab/inngest_runs/<runId>/` (see `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`).
- FlashSlot smoke/demo: `lab/flashslot_runs/<runId>/`.
- Pult smoke: `lab/inngest_runs/<event.id>/` (per handler) with `result.json`/step outputs.
- Detailed locations and checks: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`.

## Docs and inventory
- Repo inventory snapshot: `docs/inventory/INVENTORY_WF_CYCLE_REPO_v1.md`.
- Artifact reference: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`.

## FlashSlot demo (A/B/C)
Run the committed dentist A/B/C hypothesis set end-to-end (noop driver + dry-run) with one command:

```bash
npm ci && npm run demo:flashslot
```

Artifacts:
- `lab/flashslot_runs/<runId>/experiment_summary.json`
- `lab/flashslot_runs/<runId>/winner_pack/`
