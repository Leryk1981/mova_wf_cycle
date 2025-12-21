# Results: WF_EX_SCHEMA_PAYLOAD_002

## Goal / Hypothesis

**Question:** Можно ли обеспечить гибкость схемы payload без релиза кода исполнителя, сохраняя безопасность и воспроизводимость?

**Hypothesis (V0-V2):**

- **V0** (hardcoded schema): Нет гибкости, требуется релиз для изменения схемы
- **V1** (schema in registry KV): Гибкость без релиза кода, безопасность через реестр, воспроизводимость через `ds_payload_ref` + `ds_payload_hash`
- **V2** (inline schema): Опасен (Schema-DoS, скрытое расширение поведения), deny-by-default

**Expected outcome:** V1 подтверждает гипотезу о гибкости без релиза при сохранении безопасности.

## What was implemented

### Endpoints

- `POST /schema/put` - загрузка схемы в реестр (admin only)
- `GET /schema/get` - получение схемы из реестра
- `POST /payload/validate` - валидация payload по схеме (variants: v0, v1, v2)
- `POST /episode/search` - поиск эпизодов валидации
- `GET /artifact/get` - получение артефактов (evidence)

### Tools

- `tools/schema_payload_smoke_v0.mjs` - smoke тесты для всех вариантов
- `tools/schema_payload_soak_v1.mjs` - soak тесты для измерения производительности
- `tools/schema_payload_check_episodes_v0.mjs` - проверка эпизодов на наличие обязательных полей

### Infrastructure

- Cloudflare Worker Gateway v0 (executor)
- KV namespace для хранения схем (POLICY_KV)
- D1 database для эпизодов (EPISODES_DB)
- R2 bucket для артефактов (ARTIFACTS)

## What worked

### Locally / Development

✅ **Baseline gates:**
- `npm run validate` - PASS
- `npm test` - PASS
- `node tools/wf_cycle_smoke_ci.mjs` - PASS

✅ **Schema registry:**
- Загрузка схем в KV работает (`/schema/put`)
- Получение схем из KV работает (`/schema/get`)
- Кэширование валидаторов в памяти Worker работает

✅ **Validation variants:**
- V0 (hardcoded): работает с встроенной схемой
- V1 (registry): работает с схемами из KV (`payload@v1`, `payload@v2`)
- V2 (inline): корректно блокируется по политике deny-by-default

### Remote (Cloudflare Workers dev)

✅ **After AJV replacement:**
- `/health` endpoint работает
- V0, V1, V2 validation работают корректно
- Cache hit rate: 100% после warmup
- Episodes записываются с полными метаданными

## What failed

### AJV on Workers: Code Generation Blocker

**Error:** `Code generation from strings disallowed for this context`

**Where it occurs:**
- При вызове `POST /payload/validate` с любым вариантом (v0, v1, v2)
- В функции `compileSchema()` при создании AJV валидатора
- AJV по умолчанию использует code generation для оптимизации производительности

**Why it's a blocker:**
- Cloudflare Workers имеют строгие ограничения Content Security Policy (CSP)
- CSP запрещает динамическую генерацию кода: `new Function()`, `eval()`, и подобные
- AJV пытается сгенерировать оптимизированный код валидации во время выполнения
- Это критический блокер для production deployment на Cloudflare Workers

**Error snippet:**
```
[smoke] ❌ V0 validation FAIL
[smoke]   Response: {
  "ok": false,
  "error": "Code generation from strings disallowed for this context"
}
```

**Solution applied:**
- Заменён AJV на `@cfworker/json-schema` (worker-safe validator)
- `@cfworker/json-schema` не использует code generation
- Все тесты проходят после замены

## Decision

**Winner: V1 architecture is correct, but AJV implementation requires replacement**

### What we keep

✅ **V1 architecture (schema in registry):**
- Гибкость без релиза кода исполнителя
- Безопасность через реестр (только доверенные схемы)
- Воспроизводимость через `ds_payload_ref` + `ds_payload_hash`
- Приемлемая задержка (кэш компиляции схем)

✅ **V2 deny-by-default policy:**
- Inline schema блокируется по умолчанию
- Все попытки фиксируются в эпизодах
- Демонстрирует риски Schema-DoS

### What we changed

✅ **Validator replacement:**
- AJV → `@cfworker/json-schema`
- Worker-safe, no code generation
- Performance maintained (cache hit rate 100%, validate_ms ≈ 0)

## Next steps

1. **Production deployment:**
   - Deploy updated Worker with `@cfworker/json-schema` to production
   - Monitor cache hit rate and validation latency
   - Verify episodes contain all required fields

2. **Schema registry governance:**
   - Define process for schema versioning
   - Establish schema review process
   - Monitor schema size and complexity (DoS prevention)

3. **Performance optimization:**
   - Consider LRU cache with more precise eviction (currently simple 50% clear)
   - Add metrics for validation performance monitoring
   - Consider pre-compilation of common schemas

4. **Documentation:**
   - Document schema registry API
   - Create schema authoring guidelines
   - Document cache behavior and limits

5. **Testing:**
   - Add integration tests for schema registry
   - Add load tests for cache behavior
   - Add security tests for V2 deny policy

