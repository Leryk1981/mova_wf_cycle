# Deploy Instructions: WF_EX_SCHEMA_PAYLOAD_002

## 1. Установка зависимостей воркера

```bash
cd executors/cloudflare_worker_gateway_v0/worker
npm ci
cd ../../..
```

## 2. Настройка секретов (dev-воркер)

На dev-воркере должны быть два токена:

- `GATEWAY_AUTH_TOKEN` — обычный доступ к API
- `ADMIN_AUTH_TOKEN` — только для `/schema/put` и (опционально) разрешения V2

**Команды:**

```bash
cd executors/cloudflare_worker_gateway_v0/worker

# Установить обычный токен
wrangler secret put GATEWAY_AUTH_TOKEN --env dev --config wrangler.dev.jsonc

# Установить admin токен
wrangler secret put ADMIN_AUTH_TOKEN --env dev --config wrangler.dev.jsonc
```

**Важно:** `ALLOW_INLINE_SCHEMA` по умолчанию `false` (или отсутствует) — это правильно.

## 3. Деплой dev

```bash
npm run cf:deploy:gateway:dev
```

После деплоя получите URL dev-воркера (например, `https://mova-tool-gateway-v0-dev.your-subdomain.workers.dev`).

## 4. Настройка переменных окружения для тестов

```bash
# Windows PowerShell
$env:GATEWAY_URL="https://mova-tool-gateway-v0-dev.your-subdomain.workers.dev"
$env:GATEWAY_AUTH_TOKEN="your-regular-token"
$env:ADMIN_AUTH_TOKEN="your-admin-token"

# Linux/Mac
export GATEWAY_URL="https://mova-tool-gateway-v0-dev.your-subdomain.workers.dev"
export GATEWAY_AUTH_TOKEN="your-regular-token"
export ADMIN_AUTH_TOKEN="your-admin-token"
```

## 5. Прогон smoke тестов

Smoke тесты включают:
- Загрузку схем в реестр (использует `ADMIN_AUTH_TOKEN`)
- Проверки V0/V1/V2

```bash
npm run smoke:schema_payload -- --base_url "$env:GATEWAY_URL"
```

**Ожидаемое:**
- ✅ V0 valid=true
- ✅ V1 payload@v1 valid=true
- ✅ V1 payload@v2 valid=true без правок кода
- ✅ V2 inline schema → deny (и эпизод записан)

## 6. Soak тесты (сравнение V0 vs V1)

```bash
# V0
npm run soak:schema_payload -- --base_url "$env:GATEWAY_URL" --variant v0 --runs 50 --warmup 10

# V1
npm run soak:schema_payload -- --base_url "$env:GATEWAY_URL" --variant v1 --runs 50 --warmup 10
```

**Смысл:** показать, что после прогрева `compile_ms≈0`, `cache_hit` высокий, `p95` адекватный.

## 7. Проверка эпизодов в D1

Проверка, что эпизоды содержат обязательные поля:

```bash
node tools/schema_payload_check_episodes_v0.mjs --base_url "$env:GATEWAY_URL" --since_minutes 5
```

**Проверяемые поля:**
- `ds_payload_ref`
- `ds_payload_hash`
- `cache_hit`
- `compile_ms`
- `validate_ms`

## Troubleshooting

### Ошибка: "Invalid auth token" при `/schema/put`

Убедитесь, что:
1. `ADMIN_AUTH_TOKEN` установлен в секретах воркера
2. `ADMIN_AUTH_TOKEN` установлен в переменных окружения для тестов
3. Токены совпадают

### Ошибка: "Schema not found" при V1

Убедитесь, что схемы загружены в реестр через smoke тесты (они автоматически загружают схемы).

### Ошибка: "V2 inline schema not allowed"

Это ожидаемое поведение! V2 по умолчанию запрещён. Для разрешения V2 нужно:
- Использовать `ADMIN_AUTH_TOKEN`, или
- Установить `ALLOW_INLINE_SCHEMA=true` в vars воркера (не рекомендуется для production)

