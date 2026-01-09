# MOVA Agent Factory v0 — Дорожная карта (Station + Control MCP)

**Статус:** Draft v0  
**Дата:** 2026-01-09  
**Цель:** Выпустить “пустой шаблон агента” на станке и подготовить конвейер для доменных пакетов, строго по архитектуре C и правилу R1.

---

## 0) Канонические якоря (не обсуждаем дальше)

### Архитектура C
- Оркестратор (Claude Code) проектирует пакеты/пайплайны.
- Станок (`mova_wf_cycle`) собирает/проверяет/упаковывает детерминированно.
- Control MCP (`MOVA_Control_MCP`) — единственная дверь исполнения побочных действий.

### Правило R1
Оркестратор генерирует доменные пакеты, но побочные действия — только через Control MCP. “Способы” исполнения — стабильная сантехника.

---

## 1) Фаза 0 — Привести “универсальный профиль агента” к канону (документация)

**Repo:** `mova_wf_cycle` (док в станке), опционально зеркалировать в `MOVA_Control_MCP`.

Сделать:
- Добавить краткий раздел:
  - control_action vs domain_action
  - правило R1
  - канонические вызовы (станок + Control MCP)

Критерий:
- одна страница ясности, без кода

---

## 2) Фаза 1 — Пустой шаблон агента (agent_template_v0) — основной выпуск

### 2.1 Реализовать pack
**Repo:** `mova_wf_cycle`

Сделать:
- `packs/agent_template_v0/`
- схемы:
  - `ds/env.agent_template_generate_request_v0.json`
  - `ds/ds.agent_template_bundle_v0.json`
- примеры:
  - `docs/examples/pos/*.json`
  - `docs/examples/neg/*.json`
- детерминированный генератор:
  - `tools/agent_template_generate_v0.mjs`
- выходной bundle:
  - `mova/policy/policy.v0.json` (deny-by-default)
  - `mova/roles/*` (planner/executor/qa/notary)
  - `mova/instruction_profiles/*` (evidence-first, запрет секретов)
  - `mova/pipeline/pipeline_v0.json`
  - `.claude/settings.json`, `CLAUDE.md`

Критерий:
- для одного и того же input bundle стабилен (кроме run_id пути)
- нет сети, нет секретов, нет побочных действий

### 2.2 Подключить npm scripts
**Repo:** `mova_wf_cycle`

Сделать:
- `demo:agent_template`
- `quality:agent_template`
- `quality:agent_template:neg`

Критерий:
- пишутся evidence в `artifacts/`

### 2.3 Качество (pos/neg)
**Repo:** `mova_wf_cycle`

Сделать:
- `tools/quality_agent_template_v0.mjs`
- `docs/agent_template_negative_suite_v0.json`

Критерий:
- `quality:agent_template` PASS
- `quality:agent_template:neg` PASS (ожидаемые падения)

### 2.4 Интеграция в station_cycle (рекомендуется)
**Repo:** `mova_wf_cycle`

Сделать:
- step `quality_agent_template` (policy-gated)
- вендоринг отчётов в artifacts station_cycle

Критерий:
- station_cycle умеет запускать step при разрешении политикой

---

## 3) Фаза 2 — Минимальный “контракт способов” (стабилизировать сантехнику)

**Repo:** `MOVA_Control_MCP`

Сделать:
- зафиксировать и документировать минимальный набор:
  - policy_check
  - run_envelope
  - registry_list
  - search_episodes
  - get_artifact
  - approvals (опц.)
  - export/retention (опц.)
- убедиться: deny-by-default в шаблонах repo-kit неизменен

Критерий:
- quality suites Control MCP зелёные
- без доменных шаблонов в ядре

---

## 4) Фаза 3 — Скелет доменного пакета (domain_pack_scaffold_v0)

**Repo:** `mova_wf_cycle`

Сделать:
- pack `domain_pack_scaffold_v0`:
  - вход: `env.domain_pack_scaffold_request_v0`
    - `domain_action_id`
    - `control_action_type`: http | restricted_shell | mcp_proxy
    - destinations skeleton (пусто/placeholder)
  - выход: папка domain pack с ds/env/registry/examples/quality stub

Критерий:
- детерминированный скелет
- neg suite режет wildcard/missing schemas

---

## 5) Фаза 4 — Качество доменных пакетов (domain_pack_quality_v0)

**Repo:** `mova_wf_cycle`

Сделать:
- `quality:domain_pack` (pos)
- `quality:domain_pack:neg` (expected failures)
- стандартные проверки:
  - ds/env валидны
  - registry корректно ссылается на известный способ
  - policy snippet deny-by-default, без wildcard destinations
  - есть минимум: 1 pos + 2 neg примера

Критерий:
- любой новый domain pack сертифицируется до использования

---

## 6) Фаза 5 — Первый реальный domain pack (по выбору)
После доказательства “пустого шаблона”:
- минимальный домен: `http_echo` или “restricted_shell.run_gates”
- полный pos/neg proof

---

## 7) Ворота качества и доказательства (каждая фаза)

### Gates на станке (`mova_wf_cycle`) — в порядке
1) `npm ci`
2) `npm run validate`
3) `npm test`
4) `npm run smoke:wf_cycle` (или `node tools/wf_cycle_smoke_ci.mjs`)
5) `npm run codex:wrappers:check`

### Evidence (стандартизировано)
- demo: `artifacts/agent_template/<run_id>/...`
- quality: `artifacts/quality/agent_template/<run_id>/...`
- station_cycle: `artifacts/station_cycle/<run_id>/...`

---

## 8) Риски (коротко)
- ранняя “мультиагентность” создаёт хаос → держим дисциплину pipeline + evidence refs
- дрейф между документом и кодом → всё обещаемое должно быть проверяемым в pos/neg
- раздувание доменов → способы (control actions) остаются минимальными и стабильными
