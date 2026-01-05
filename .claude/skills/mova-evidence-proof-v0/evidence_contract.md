# Evidence contract

## What counts as evidence
- Command output for gates/quality (`npm run validate`, `npm test`, `npm run smoke:*`).
- Generated reports and artifacts under `artifacts/**`.
- `git status -sb` and `git diff --stat` when changes exist.

## Where to store
- Use `artifacts/<area>/<timestamp_or_run_id>/...` if a tool does not create paths.
- Reference exact paths in the final report.

## Safety and determinism
- Do not paste tokens; use env vars only.
- Keep run-specific data in env/meta; results go in payloads and artifacts.

## MCP mapping
| Intent | Tool |
| --- | --- |
| Action executed | mova_run_envelope_v0 |
| Episode lookup | mova_search_episodes_v0 |
| Local gates | npm run ... / mova_run_npm_v0 |
