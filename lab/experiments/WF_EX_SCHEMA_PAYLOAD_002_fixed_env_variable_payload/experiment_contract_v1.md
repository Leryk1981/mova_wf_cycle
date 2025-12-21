# Experiment Contract v1: WF_EX_SCHEMA_PAYLOAD_002

## Периметр эксперимента

### Frozen (неизменяемое)

1. **executor_ref**: `cloudflare_worker_gateway_v0`
2. **engine_identity**: фиксированный env режима (production/dev)
3. **policy**: deny-by-default для V2 (inline schema)

### Variable (изменяемое)

1. **ds.payload версия/хэш**: версия схемы и хэш payload данных
2. **payload data**: сами данные payload (валидируются по схеме)

### Запреты

- ❌ `payload`/схема **не могут** добавлять операции
- ❌ `payload`/схема **не могут** добавлять домены
- ❌ `payload`/схема **не могут** добавлять инструменты

Схема валидирует только **структуру данных**, не поведение.

### Обязательные поля эпизода

Каждый эпизод типа `payload_validate` должен содержать:

- `ds_payload_ref`: ссылка на схему (например, `payload@v2`)
- `ds_payload_hash`: SHA256 хэш payload данных
- `cache_hit`: `true`/`false` (попадание в кэш компиляции)
- `compile_ms`: время компиляции схемы (мс)
- `validate_ms`: время валидации payload (мс)

### Типы эпизодов

- `payload_validate`: валидация payload по схеме

### Схемы

- `ds.payload_v1.json`: минимальная домена-нейтральная схема
- `ds.payload_v2_extended.json`: расширенная схема (добавлены поля)
- `ds.payload_attack_v1.json`: тяжёлая/подозрительная схема для демонстрации V2-риска

