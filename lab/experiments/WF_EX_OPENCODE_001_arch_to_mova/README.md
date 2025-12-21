# Experiment WF_EX_OPENCODE_001_arch_to_mova

Scaffold generated via `skill.wf_cycle_scaffold_basic`.

## Goal
Run wf_cycle (A/B/C) inside dedicated attempt zones without touching canonical inputs.

## Participants
- codex_ide: `attempts/codex_ide/wf_cycle`
- codex_cli: `attempts/codex_cli/wf_cycle`

## Structure
- `rules/` — scope, evidence checklist, diff-guards.
- `inputs/` — workflow target + contextual briefs.
- `attempts/<participant>/wf_cycle/` — artifacts, bindings, runs.
- `compare/` & `outputs/` — to be populated during the experiment.

## Guardrails
- Never write to `lab/memory/**`.
- diff-guard must pass before sharing results.

## Next steps
Customize inputs, fill binding maps, and start Attempt A (spiral).