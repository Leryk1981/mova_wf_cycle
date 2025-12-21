# mova_wf_cycle v0.1.0

- Standalone wf_cycle factory lifted out of Codex lab with scaffold/compare/winner_pack + driver probes gate wired in.
- Local Inngest "pult" exposes smoke/full/experiment events, keeps artifacts for every step, and is wired into docs + helper scripts.
- Deterministic npm scripts (`validate`, `test`, `smoke:wf_cycle`, `smoke:pult`) form the baseline and run in CI on Windows & Ubuntu.
- GitHub Actions workflow runs validate/test/smoke and optional pult smoke with cleanup flag enabled.

## How to run locally
- `npm ci`
- `npm run smoke:wf_cycle`
- `npm run smoke:pult`

Artifacts land under `lab/inngest_runs/<event.id>/...` with per-step stdout/stderr/result.json plus wf_cycle_full / experiment summaries.
By default `smoke:pult` does **not** kill third-party inngest processes; set `PULT_SMOKE_KILL_STRAY=1` (CI mode) if you need enforced cleanup.
