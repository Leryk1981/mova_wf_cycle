---
description: List key npm scripts in this repo (gates/quality/station/wf) to quickly discover entry points.
argument-hint: [filter]  (optional keyword)
allowed-tools: Bash(node -p:*)
---

## Task
Print a concise list of scripts from package.json, focused on:
- validate, test, smoke, wrappers
- quality
- station / cycle
- wf / attempt / compare / winner
- episode / memory

If `$ARGUMENTS` is provided, filter script names by that keyword (case-insensitive).

Command(s):
- Use Node to read package.json scripts and print matches only.

Output:
- A sorted list of script names (one per line).
