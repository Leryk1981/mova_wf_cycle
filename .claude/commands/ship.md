---
description: Run the station service ship job (fast gates + deploy wrappers) and surface the job report path.
argument-hint: [args...]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch --show-current), Bash(npm run ship:agent)
---

## Context (do not edit)
- Branch: !`git branch --show-current`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`

## Task
Goal: run the ship job deterministically and return the report location.

Steps:
1) Print a short "how to use ship" note (2-4 lines max).
2) Run `npm run ship:agent -- $ARGUMENTS` if arguments are supplied; otherwise run `npm run ship:agent`.
3) Output the path to `agent_job_report.json` from the command output.
