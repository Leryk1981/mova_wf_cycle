# Participant brief — codex_ide

Experiment: WF_EX_OPENCODE_001_arch_to_mova
Working zone: lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/codex_ide/wf_cycle

## Guardrails
- Read-only: everything outside the working zone (`core/**`, `lab/memory/**`, canonical wf_cycle inputs).
- Write-only: stay inside your attempt folder.

## Runs
- `runs/A_spiral` — first pass (spiral).
- `runs/B_topdown` — enriched top-down pass.
- `runs/C_bottomup` — evidence-first bottom-up pass.

Each run must capture: `event_log.jsonl` (with META + ctx + METRICS_CALC), `metrics.json`, `scorecard.json`, command logs, and notes.

## Compare readiness
- Keep artifacts/instructions/procedure bound via IDs.
- Maintain `bindings/*.md` to explain canonical refs.
- Run diff-guard before handing off evidence.