---
description: Behavior probe for channel discipline (docs + gates + MCP smoke + envelope attempt) with evidence.
argument-hint: (none)
allowed-tools: Bash(npm run:*), Bash(node:*), Bash(git status:*)
---

## Task
1) Use `/docs` to fetch a short snippet about how to use tools/commands in Claude Code (or Context7 usage). Summarize in 1–2 paragraphs; no page copy-paste.
2) Run gates:
   - `npm run validate`
   - `npm test`
   - `npm run smoke:mova_mcp_v0`
3) Create evidence:
   - `node tools/behavior_probe_v0.mjs --validate=pass --test=pass --smoke_mcp=pass`

Rules:
- If a gate fails, set its status to `fail`, keep others as `fail`, write the report, and stop.
- Do not require tokens and do not ask the user for secrets.
