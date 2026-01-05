---
description: PR readiness report for the current branch (ahead/behind, recommended actions) via best matching npm script.
argument-hint: [preflight|report] [base=<ref>] [target=<ref>]  (passed through if supported)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch --show-current), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(node -p:*), Bash(npm run:*)
---

## Context (do not edit)
- Branch: !`git branch --show-current`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`
- HEAD: !`git rev-parse --short HEAD`

- Candidate finish/branch scripts:
  !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/(finish.*branch|finish|branch.*finish|pr.*ready|ready.*pr|finish_branch)/i.test(s)).sort().join('\n') || 'NO_MATCH'"`

## Task
Goal: produce a concise PR readiness report (ahead/behind + recommended actions) using the repo's finish-branch tooling.

Rules:
- Do not invent commands or outputs.
- Prefer running an existing npm script for finish_branch / PR readiness.
- If a matching script exists, run it as:
  - `npm run <script> -- $ARGUMENTS` (only if the script supports args; otherwise run without args).
- If NO_MATCH:
  - Do NOT invent.
  - Fallback: compute ahead/behind against the default remote branch if detectable:
    - try origin/main, then origin/master.
    - show `git rev-list --left-right --count <base>...HEAD`
  - Report the computed counts in the output.

Output:
- Selected script (or fallback base ref) + the key results.
- Ahead/behind counts (or explain why not available).
- Any recommended actions printed by the tool.
- Point to artifacts path if the tool generated reports (often artifacts/finish_branch/...).
- End with `git status -sb`.
