---
description: Run the station orchestrator (station_cycle) using the best matching npm script, then summarize artifacts and recommendations.
argument-hint: [args...]  (passed through to the station script if supported)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch --show-current), Bash(node -p:*), Bash(npm run:*), Bash(npm test), Bash(npm run validate)
---

## Context (do not edit)
- Branch: !`git branch --show-current`
- Status: !`git status -sb`
- Diff (stat): !`git diff --stat`
- Candidate station scripts:
  !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/station|cycle/i.test(s)).sort().join('\n') || 'NO_MATCH'"`

## Task
Goal: run the station orchestrator deterministically and report results.

Steps:
1) If there is an npm script that clearly matches station_cycle (prefer names containing both 'station' and 'cycle'), run it as:
   - `npm run <script> -- $ARGUMENTS` (only if the script supports args; otherwise run without `-- $ARGUMENTS`).
2) If NO_MATCH:
   - Do NOT invent commands.
   - Ask the user which script/entrypoint should be used, and show the full scripts list filtered for 'wf', 'quality', 'finish', 'episode' to help pick.

Output:
- What script was executed and with which args.
- PASS/FAIL summary (or partial results if the run is structured).
- Pointers to the newest artifacts directory it produced (usually under artifacts/station_cycle/…).
- Any recommended follow-up actions if the report contains them.
