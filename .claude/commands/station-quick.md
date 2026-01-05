---
description: One-button station run: gates -> (auto) quality -> finish-branch -> (optional) episode-store, with evidence.
argument-hint: [full] [fix] [invoice|gateway|both|none]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(node -p:*), Bash(npm ci), Bash(npm run:*), Bash(ls:*), Bash(dir:*)
---

## Context (do not edit)
- Branch: !`git rev-parse --abbrev-ref HEAD`
- HEAD: !`git rev-parse --short HEAD`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`
- Changed files: !`git diff --name-only`

- Candidate scripts (discover, do not guess):
  - station/cycle:
    !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/station|cycle/i.test(s)).sort().join('\n') || 'NO_MATCH'"`
  - quality:
    !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/^quality:/i.test(s)).sort().join('\n') || 'NO_MATCH'"`
  - finish/branch:
    !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/(finish.*branch|finish_branch|pr.*ready|ready.*pr)/i.test(s)).sort().join('\n') || 'NO_MATCH'"`
  - episode/memory:
    !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/(episode.*store|store.*episode|episode_store|store_episode|memory.*store)/i.test(s)).sort().join('\n') || 'NO_MATCH'"`

- Remote episode store env (presence only):
  - STORE_EPISODE_REMOTE_URL present: !`node -p "Boolean(process.env.STORE_EPISODE_REMOTE_URL)"`
  - STORE_EPISODE_REMOTE_TOKEN length: !`node -p "(process.env.STORE_EPISODE_REMOTE_TOKEN||'').length"`

## Task
You are the operator of a deterministic workflow machine. Run a single “station cycle” with evidence.

### A) Gates (always)
Order:
1) npm run validate
2) npm test
3) npm run smoke:wf_cycle
4) npm run codex:wrappers:check

If `$ARGUMENTS` contains `full`, run `npm ci` before gates.
If a gate fails:
- If `$ARGUMENTS` contains `fix`: apply minimal fix and rerun failing gate, then rerun full gate sequence.
- Otherwise stop and report.

### B) Quality (auto unless forced)
Decide which quality suite(s) to run:
- If `$ARGUMENTS` contains `invoice` -> run `quality:invoice_ap` and `quality:invoice_ap:neg` if they exist.
- If `$ARGUMENTS` contains `gateway` -> run `quality:gateway` and `quality:gateway:neg` if they exist.
- If `$ARGUMENTS` contains `both` -> run both sets if they exist.
- If `$ARGUMENTS` contains `none` -> skip quality.
- Otherwise (auto): infer from changed files:
  - If paths include `packs/invoice`, `workers/mova-invoice`, `invoice_` -> invoice quality.
  - If paths include `gateway`, `gw_`, `mova-tool-gateway` -> gateway quality.
  - If both match -> ask the user which one to run (default to both if user doesn’t answer).

If a quality run fails:
- If `fix` is present: minimal fix -> rerun failing suite -> rerun selected suites.
- Otherwise stop and report.

### C) Finish-branch (PR readiness)
Prefer an existing npm script from the discovered list.
If none exists, compute ahead/behind vs origin/main (fallback origin/master):
- `git rev-list --left-right --count origin/main...HEAD`

### D) Episode store (optional, safe)
Only attempt if:
- STORE_EPISODE_REMOTE_URL is present AND STORE_EPISODE_REMOTE_TOKEN length > 0
Prefer an existing npm script from the discovered list.
If not configured: report SKIP with which env var(s) are missing (names only, no values).

### Output (Definition of Done)
- Table: step -> command(s) -> PASS/FAIL -> key notes
- Evidence:
  - `git status -sb`
  - `git diff --stat` (if changed)
  - For quality/station: newest artifacts path(s) printed by scripts (or under artifacts/* if obvious from output)
- If anything was skipped: explain why and what to set/do next.
