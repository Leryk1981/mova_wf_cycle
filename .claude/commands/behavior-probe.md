---
description: Behavior probe for channel discipline (docs + gates + MCP smoke + envelope attempt) with evidence.
argument-hint: (none)
allowed-tools: Bash(npm run:*), Bash(node:*), Bash(git status:*)
---

## Task
1) Use `/docs` to fetch a short snippet about how to use tools/commands in Claude Code (or Context7 usage). Summarize in 1–2 paragraphs; no page copy-paste.
2) Run the probe:
   - `npm run probe:behavior`
3) Show the report path:
   - `artifacts/behavior_probe/<run_id>/probe_report.json`

Rules:
- Do not require tokens and do not ask the user for secrets.
