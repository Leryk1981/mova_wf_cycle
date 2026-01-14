# MOVA wf_cycle standalone — українська версія

## Що це зараз
- Детермінована машина wf_cycle (scaffold → probes → compare → winner_pack) з рантаймами та Codex-обгортками у `.codex/skills/`.
- Пакети, рантайми, ingest-утиліти та FlashSlot v0 виконуються локально та відтворювано.
- `station_cycle_v1` керує snapshot/gates/wf_cycle/episode_store/finish_branch з політиками та артефактами.
- Хмарна памʼять епізодів v0 на Cloudflare Worker + D1 (`executors/cloudflare_worker_gateway_v0/worker`) дає `/episode/store` та `/episode/search`.

## Швидкий старт (локально)
1. `npm ci`
2. `npm run validate`
3. `npm test`
4. `npm run smoke:wf_cycle`

Усі чотири кроки мають проходити на кожній гілці перед передачею задач Codex.

## Codex wrappers
- Після змін у `skills/` виконуйте:
  - `npm run codex:wrappers:gen`
  - `npm run codex:wrappers:check`
- Обгортки запускають реальні binding-и через `.codex/skills/mova_<skill_id>/scripts/run.mjs`.

## station_cycle
- Приклади запитів: `docs/examples/station_cycle_request_snapshot_override.json` тощо.
- Запуск:
  ```bash
  node .codex/skills/mova_station_cycle_v1/scripts/run.mjs --request docs/examples/station_cycle_request_snapshot_override.json
  ```
- Артефакти: `artifacts/station_cycle/<runId>/` (логи кроків, `policy_events.jsonl`, скопійовані finish_branch-звіти, `episode_store_result.json`).

## Віддалена памʼять епізодів (Cloudflare Worker + D1)
- Ендпоїнти:
  - Dev: `https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev`
  - Prod: `https://mova-tool-gateway-v0.s-myasoedov81.workers.dev`
- API:
  - `POST /episode/store` — приймає `env.skill_ingest_run_store_episode_v1`.
  - `POST /episode/search` — пошук за `episode_id`, `type`, `source`, timestamp.
- Авторизація: Bearer token (`GATEWAY_AUTH_TOKEN` у воркері).
- `skill_ingest_store_episode_basic` читає:
  - `STORE_EPISODE_REMOTE_URL`
  - `STORE_EPISODE_REMOTE_TOKEN`
  - (опційно) `STORE_EPISODE_BASE_DIR` для локального fallback.
- Приклад:
  ```bash
  STORE_EPISODE_REMOTE_URL=https://mova-tool-gateway-v0.s-myasoedov81.workers.dev/episode/store \
  STORE_EPISODE_REMOTE_TOKEN=*** \
  node .codex/skills/mova_skill_ingest_store_episode_basic/scripts/run.mjs --request <шлях/до/envelope.json>
  ```
- Відповіді на зберігання/пошук фіксуйте у `artifacts/cloudflare_memory_prod/`.

## FlashSlot Boot Camp A (noop)
1. Використовуйте зразок `docs/examples/flashslot_publish_offer_request_sample.json`.
2. Запуск:
   ```bash
   node packs/_quarantine/flashslot_v0/runtime/impl/publish_offer_v0.mjs \
     --in docs/examples/flashslot_publish_offer_request_sample.json \
     --out artifacts/flashslot_publish/sample_run \
     --driver noop
   ```
3. Збережіть епізод через `mova_skill_ingest_store_episode_basic` (env змінні вище) та перевірте `/episode/search`.
4. Артефакти: `artifacts/flashslot_publish/<run>/request.json`, `result.json`, evidence.

## Довідники
- Англійська версія: `README.md`
- Гайд по артефактах: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`
- Інвентар: `docs/inventory/INVENTORY_WF_CYCLE_REPO_v1.md`
