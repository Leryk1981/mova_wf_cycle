# MOVA wf_cycle standalone — українська версія

## Статус та призначення
- Детермінований фабричний пайплайн wf_cycle з локальним контрольним центром Inngest (“pult”), без зовнішніх SaaS/AI.
- Усі виконання відтворювані; контекст MOVA описаний у `MOVA_CONTEXT_PACK.md`.

## Швидкий старт
1. `npm ci`
2. `npm run smoke:wf_cycle`
3. `npm run smoke:flashslot`
4. Опційно: `PULT_SMOKE_ENABLE=1 npm run smoke:pult` (за замовчуванням пропускається)

## Ключові посилання
- Англійська версія: `README.md`
- Гайд по артефактах: `docs/WF_CYCLE_ARTIFACTS_GUIDE_v1.md`
- Інвентар репозиторію: `docs/inventory/INVENTORY_WF_CYCLE_REPO_v1.md`
