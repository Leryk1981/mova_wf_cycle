---
description: Run Gateway quality suites (pos + neg) and summarize results with artifact paths.
argument-hint: [fix]  (fix=attempt minimal fixes if a suite fails)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch --show-current), Bash(npm run quality:gateway), Bash(npm run quality:gateway:neg)
---

## Context (do not edit)
- Branch: !`git branch --show-current`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`

## Task
Run both quality suites:
1) npm run quality:gateway
2) npm run quality:gateway:neg

Rules:
- Do not guess. Trust command output.
- If a suite fails and `$ARGUMENTS` contains `fix`: apply the minimal fix and rerun the failing suite, then rerun both suites.
- Otherwise: stop and report.

Output:
- PASS/FAIL for each suite.
- If possible, point to the newest quality artifact directory under artifacts/quality/ (or whatever the scripts print).
- End with `git status -sb` and a short diff summary if any edits were made.
