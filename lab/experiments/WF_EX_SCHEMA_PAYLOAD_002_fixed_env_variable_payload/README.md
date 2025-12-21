# WF_EX_SCHEMA_PAYLOAD_002: Fixed Env, Variable Payload

## Вопрос

Можно ли обеспечить гибкость схемы payload без релиза кода исполнителя, сохраняя безопасность и воспроизводимость?

## Гипотеза

Вариант V1 (фиксированный env рядом с кодом, меняется только `ds.payload` через реестр) даёт:
- ✅ Гибкость без релиза кода исполнителя
- ✅ Безопасность (данные не расширяют поведение)
- ✅ Воспроизводимость (вход + `ds_payload_hash` → детерминированный результат)
- ✅ Приемлемую задержку (кэш компиляции схем)

Вариант V2 (пользователь присылает схему) — риск:
- ❌ Schema-DoS (тяжёлые схемы)
- ❌ Скрытое расширение поведения

## Варианты

### V0: Схема "вшита" в код
- Схема `ds.payload_v1.json` захардкожена в Worker
- Нет гибкости, требуется релиз для изменения схемы

### V1: Схема в реестре (KV)
- Схема хранится в KV по ключу `schema:<schema_id>:<version>`
- Worker загружает схему по `schema_ref` из запроса
- Кэш компиляции схем в памяти Worker
- Гибкость без релиза, безопасность через реестр

### V2: Inline схема (опасно)
- Схема приходит в теле запроса (`schema_inline`)
- По умолчанию запрещено (deny-by-default)
- Разрешено только для admin-токена
- Демонстрирует риски: Schema-DoS, скрытое расширение

## Метрики

- `cache_hit`: попадание в кэш компиляции схемы
- `compile_ms`: время компиляции схемы (AJV)
- `validate_ms`: время валидации payload
- `p95 validate_ms`: 95-й перцентиль времени валидации
- `p95 total_ms`: 95-й перцентиль общего времени запроса
- Cache hit rate: процент попаданий в кэш

## Как запускать

### 1. Деплой Worker (dev)
```bash
npm run cf:deploy:gateway:dev
```

### 2. Загрузка схем в реестр
```bash
# Загрузить ds.payload_v1
node tools/schema_payload_smoke_v0.mjs --base_url "<DEV_WORKER_URL>" --action put_schema --schema_id payload --version v1 --schema_file lab/experiments/WF_EX_SCHEMA_PAYLOAD_002_fixed_env_variable_payload/schemas/ds.payload_v1.json

# Загрузить ds.payload_v2
node tools/schema_payload_smoke_v0.mjs --base_url "<DEV_WORKER_URL>" --action put_schema --schema_id payload --version v2 --schema_file lab/experiments/WF_EX_SCHEMA_PAYLOAD_002_fixed_env_variable_payload/schemas/ds.payload_v2_extended.json
```

### 3. Smoke тесты
```bash
npm run smoke:schema_payload -- --base_url "<DEV_WORKER_URL>"
```

### 4. Soak тесты
```bash
npm run soak:schema_payload -- --base_url "<DEV_WORKER_URL>" --variant v1 --runs 50 --warmup 10
```

## Критерии приёмки

- ✅ V1: загрузили `payload@v2` в registry, payload с новыми полями проходит без изменения кода
- ✅ V2: inline schema обычным токеном → deny (эпизод фиксируется)
- ✅ В ответах есть: `ds_payload_ref`, `ds_payload_hash`, `cache_hit`, `compile_ms`, `validate_ms`
- ✅ Soak (50 прогонов): при warm cache `compile_ms≈0`, `cache_hit` высокий


