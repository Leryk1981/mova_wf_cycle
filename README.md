# MOVA wf_cycle standalone

## What this repo is now
- Deterministic wf_cycle machine with scaffold → probes → compare → winner_pack runners wired through Codex wrappers in `.codex/skills/`.
- Packs and runtimes (FlashSlot v0, wf_cycle packs, ingest helpers) all live in-repo for reproducible runs.
- `station_cycle_v1` orchestrates snapshot/gates/wf_cycle/episode_store/finish_branch with evidence trails + policy.
- Remote episode memory v0 (Cloudflare Worker + D1) provides `/episode/store` and `/episode/search` for storing real runs.
- Cloudflare worker sources + migrations live in `executors/cloudflare_worker_gateway_v0/worker`.

## Quickstart (Local)
1. `npm ci`
2. `npm run validate`
3. `npm test`
4. `npm run smoke:wf_cycle`

All four commands must pass on every branch before asking Codex to continue.

## Codex wrappers
- Generate or refresh wrappers after touching `skills/` or schema files:
  - `npm run codex:wrappers:gen`
  - `npm run codex:wrappers:check`
- Wrappers surface runnable bindings via `.codex/skills/mova_<skill_id>/scripts/run.mjs`.

## Station cycle
- Requests live in `docs/examples/` (e.g. `docs/examples/station_cycle_request_snapshot_override.json`).
- Run full cycle:  
  ```bash
  node .codex/skills/mova_station_cycle_v1/scripts/run.mjs --request docs/examples/station_cycle_request_snapshot_override.json
  ```
- Outputs: `artifacts/station_cycle/<runId>/` with per-step logs, vendored finish_branch reports, `policy_events.jsonl`, and `episode_store_result.json` when remote storage succeeds.

## Remote episode memory (Cloudflare Worker + D1)
- Worker endpoints:  
  - Dev: `https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev`  
  - Prod: `https://mova-tool-gateway-v0.s-myasoedov81.workers.dev`
- API routes:
  - `POST /episode/store` — accepts `env.skill_ingest_run_store_episode_v1` envelope.
  - `POST /episode/search` — filters by `episode_id`, `type`, `source`, timestamps, `limit`.
- Auth: Bearer token must match `GATEWAY_AUTH_TOKEN` secret configured on the worker.
- `skill_ingest_store_episode_basic` reads these env vars (or CLI overrides) when run through the wrapper:
  - `STORE_EPISODE_REMOTE_URL`
  - `STORE_EPISODE_REMOTE_TOKEN`
  - (Optional file storage fallback: `STORE_EPISODE_BASE_DIR`)
- Example store call via wrapper:  
  ```bash
  STORE_EPISODE_REMOTE_URL=https://mova-tool-gateway-v0.s-myasoedov81.workers.dev/episode/store \
  STORE_EPISODE_REMOTE_TOKEN=*** \
  node .codex/skills/mova_skill_ingest_store_episode_basic/scripts/run.mjs --request <path/to/envelope.json>
  ```
- Search via `Invoke-RestMethod`/`curl` and capture responses under `artifacts/cloudflare_memory_prod/`.

## FlashSlot Boot Camp A (noop driver sample)
1. Prepare sample request (already committed): `docs/examples/flashslot_publish_offer_request_sample.json`.
2. Run publish runtime:  
   ```bash
   node packs/flashslot_v0/runtime/impl/publish_offer_v0.mjs \
     --in docs/examples/flashslot_publish_offer_request_sample.json \
     --out artifacts/flashslot_publish/sample_run \
     --driver noop
   ```
3. Store to remote memory with `skill_ingest_store_episode_basic` (same env vars as above).
4. Search `/episode/search` for the emitted `episode_id` to confirm persistence.
5. Artifacts land in `artifacts/flashslot_publish/<run>/` (`request.json`, `result.json`, driver evidence).

## Invoice AP Boot Camp v0
1. Use sample intake request: `docs/examples/invoice_intake_request_sample.json`.
2. Run deterministic runtime:
   ```bash
   node packs/invoice_ap_v0/runtime/impl/invoice_intake_v0.mjs \
     --in docs/examples/invoice_intake_request_sample.json \
     --out artifacts/invoice_ap/sample_run
   ```
3. The runtime writes `request.json`, `result.json`, and `evidence/totals.json`.
4. Store and search the run through the Cloudflare worker using `mova_skill_ingest_store_episode_basic` and `/episode/search` exactly as described above (reuse PROD env vars).

## Attempt protocol (single-branch)
- IDE vs CLI comparisons stay on one branch; every run drops evidence under `artifacts/attempts/<label>/<run_id>/`.
- Run Attempt A for invoice intake (IDE path):  
  ```bash
  npm run attempt:invoice:a
  ```
- The helper (`tools/attempt_run.mjs`) captures stdout/stderr, normalized request/result/totals, and the config snapshot so both IDE/CLI attempts can be diffed without juggling branches.

## Reference docs
- FlashSlot operator guides: `docs/flashslot/OPERATOR_CHECKLIST_v0.md`, `docs/flashslot/OPERATOR_DEMO_v0.md`.
- WF cycle artifacts: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`.
- Repository inventory: `docs/inventory/INVENTORY_WF_CYCLE_REPO_v1.md`.
