# mova_wf_cycle — Operating Rules (Deterministic Workflow Machine)

## Language
- Communicate with the user in Russian.
- Keep code, API names, CLI commands, file paths, and error messages in English exactly as-is.
- If referencing docs, paraphrase in Russian; do not translate identifiers.

## Non-negotiables
- Do not guess. If unsure, use tools: read files, run commands, and use IDE diagnostics.
- Never fabricate file contents, command output, test results, or CI status.
- Never access secrets. Do not read .env, .env.*, secrets/**, or any private keys. If needed, ask the user to provide redacted values.
- Keep outputs deterministic: request/result/totals must be stable. Run-specific details (timestamps, run ids, paths) belong only in env.json and artifacts.

## Repo Reality (how this project works)
- This repo is a deterministic “station” for workflows.
- Preferred verification gates (in this order):
  1) npm run validate
  2) npm test
  3) npm run smoke:wf_cycle
  4) npm run codex:wrappers:check
- Domain quality suites exist (e.g. quality:*). If you touch a domain area, run its quality suite(s).

## Default work protocol
1) Start in Plan Mode (read-only). Produce a short plan with:
   - Files to inspect
   - Minimal change set
   - Verification commands to run (gates + any domain quality)
2) Read the exact files you will modify BEFORE proposing edits.
3) Implement in small batches (1–3 files), then re-check diagnostics.
4) Run gates. If something fails, fix and re-run until green.
5) Provide evidence:
   - command(s) you ran
   - pass/fail outcome
   - paths to generated reports/artifacts if any

## Tool discipline (important when using non-Claude models)
- Prefer tools over intuition. If an answer can be checked, check it.
- Use IDE diagnostics as the source of truth for compilation/type errors.
- If you propose a change that affects behavior, write/adjust tests or extend the relevant quality suite.

## Git hygiene
- Do not commit generated artifacts or run outputs unless explicitly requested.
- Before finishing: show `git status -sb` and a concise `git diff` summary.

## Definition of Done (evidence required)
Every change must end with:
- `git status -sb`
- `git diff --stat` (if anything changed)
- list of verification commands executed + PASS/FAIL
- if quality/station ran: paths to newest artifacts/reports and 1–2 key conclusions
- no fabricated outputs; if unsure, re-run the command
