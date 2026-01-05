---
description: Run repo gates (validate -> test -> smoke:wf_cycle -> codex:wrappers:check) and summarize PASS/FAIL.
argument-hint: [fix] [full]  (fix=attempt minimal fixes; full=run npm ci first)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch --show-current), Bash(node -v), Bash(npm -v), Bash(npm ci), Bash(npm run validate), Bash(npm test), Bash(npm run smoke:wf_cycle), Bash(npm run codex:wrappers:check)
---

## Context (do not edit)
- Branch: !`git branch --show-current`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`
- Node: !`node -v`
- npm: !`npm -v`

## Task
You are running the repo's standard gates deterministically.

Rules:
- Do not guess. Trust command output.
- If `$ARGUMENTS` contains `full`, run `npm ci` before gates.
- Run gates in this order:
  1) npm run validate
  2) npm test
  3) npm run smoke:wf_cycle
  4) npm run codex:wrappers:check
- If any gate fails:
  - If `$ARGUMENTS` contains `fix`, attempt the minimal fix (smallest change set) and rerun only the failing gate; then rerun the full sequence.
  - Otherwise: stop, report the failure and likely root cause.

Output:
- A compact report with PASS/FAIL for each gate, and for failures include the exact failing command and the key error excerpt.
- End with `git status -sb` and a short diff summary if any edits were made.
