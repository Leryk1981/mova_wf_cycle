---
name: mova-station-operator-v0
description: Use for running station one-button flow (gates -> quality -> finish-branch -> episode store) with evidence paths and zero interactive branches.
allowed-tools: Bash, Read, Grep, Glob
---

## Default action
- Prefer `/station-quick` for the full one-button flow.
- If only verification is requested, use `/gates`.

## Evidence checklist
- Collect artifacts from `artifacts/**` as printed by scripts.
- Always include `git status -sb` and `git diff --stat` when changes exist.
- If quality or station ran, note the newest artifacts path(s).

## Rules
- Documentation: use `/docs` via Context7 MCP only (read-only).
- Execution and side effects: run via station (npm scripts) and/or MOVA-controlled paths.
- No interactive branches; pick safe defaults and proceed.
