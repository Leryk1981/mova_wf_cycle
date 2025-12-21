# Phase 4 Runbook: WF_EX_SCHEMA_PAYLOAD_002

## 1. Секреты (важно: теми же флагами, что и deploy)

```bash
cd executors/cloudflare_worker_gateway_v0/worker
wrangler secret put GATEWAY_AUTH_TOKEN --env dev --config wrangler.dev.jsonc
wrangler secret put ADMIN_AUTH_TOKEN --env dev --config wrangler.dev.jsonc
cd ../../..
```

**Правило:** секреты должны ставиться в тот же target, что и deploy (используем `--env dev --config wrangler.dev.jsonc`).

## 2. Deploy

```bash
npm run cf:deploy:gateway:dev
```

**Скопируй URL воркера из вывода.**

## 3. Smoke (он же: put_schema + validate)

```powershell
$env:GATEWAY_URL="<DEV_WORKER_URL>"
$env:GATEWAY_AUTH_TOKEN="<token>"
$env:ADMIN_AUTH_TOKEN="<admin-token>"

npm run smoke:schema_payload -- --base_url $env:GATEWAY_URL
```

**Критерии PASS:**
- ✅ Схемы реально загрузились через `/schema/put` (admin token)
- ✅ V0/v1 payload валидируется
- ✅ V2 inline schema → deny с `policy_check.decision=deny` и `rule_id=v2_inline_schema_deny`

## 4. Soak (с цифрами, ради которых всё затевалось)

Прогнать оба: v0 и v1 — чтобы сравнение было честным.

```powershell
npm run soak:schema_payload -- --base_url $env:GATEWAY_URL --variant v0 --runs 50 --warmup 10
npm run soak:schema_payload -- --base_url $env:GATEWAY_URL --variant v1 --runs 50 --warmup 10
```

**Смотрим:**
- ✅ `cache_hit` после прогрева высокий
- ✅ `compile_ms` почти ноль после warmup
- ✅ `p95` у v1 не "улетает" относительно v0 (разница в миллисекунды — это победа)

## 5. Проверка эпизодов (обязательные поля на месте)

```powershell
node tools/schema_payload_check_episodes_v0.mjs --base_url $env:GATEWAY_URL
```

## Что принести после Phase 4

1. **Вывод smoke** (коротко, без простынь)
2. **Summary soak** (p95 + cache_hit) по v0 и v1
3. **Результат schema_payload_check_episodes_v0** (PASS/FAIL + сколько эпизодов проверено)

