# Station Service Agent v0

## What it does
- Runs fast gates: `npm run validate`, `npm test`, `npm run smoke:wf_cycle`.
- Deploys a Vercel app through `tools/vercel_deploy_v0.mjs` when configured.
- Deploys a Cloudflare Worker through `tools/cf_worker_deploy_v0.mjs` when configured.
- Writes a unified report: `artifacts/agent_ship/<run_id>/agent_job_report.json`.

## Configuration (no secrets in logs)
Required for Vercel deploy:
- `VERCEL_TOKEN` (or `VERCEL_ACCESS_TOKEN`)
- `SHIP_VERCEL_CWD` (path to the app directory)
- Optional: `SHIP_VERCEL_MODE=prod|preview` (default: `preview`)

Required for Cloudflare Worker deploy:
- `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_API_KEY`)
- `SHIP_CF_WORKER_DIR` (path to the worker directory)
- Optional: `SHIP_CF_ENV=prod|dev` (default: `prod`)

Note: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `CLOUDFLARE_ACCOUNT_ID` can be provided as usual for CLI tools, but this agent never prints their values.

## Paths, not logs
The agent prints only:
- `report_path=...` to the unified report.
- A one-line status summary.

All stdout/stderr are written to artifact files under the run directory.

## Artifacts
- Ship report: `artifacts/agent_ship/<run_id>/agent_job_report.json`
- Vercel deploy: `artifacts/vercel_deploy/<run_id>/report.json`
- Cloudflare deploy: `artifacts/cf_worker_deploy/<run_id>/report.json`
