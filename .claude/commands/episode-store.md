---
description: Store the latest episode/evidence to remote memory if configured; otherwise report what's missing safely.
argument-hint: [strict] [run=<id>]  (passed through if supported)
allowed-tools: Bash(git status:*), Bash(node -p:*), Bash(npm run:*), Bash(dir:*), Bash(ls:*)
---

## Context (do not edit)
- Status: !`git status -sb`

- Remote episode store env (presence only, no secrets):
  - STORE_EPISODE_REMOTE_URL present: !`node -p "Boolean(process.env.STORE_EPISODE_REMOTE_URL)"`
  - STORE_EPISODE_REMOTE_TOKEN length: !`node -p "(process.env.STORE_EPISODE_REMOTE_TOKEN||'').length"`
  - STORE_EPISODE_BASE_DIR present: !`node -p "Boolean(process.env.STORE_EPISODE_BASE_DIR)"`

- Candidate episode/memory scripts:
  !`node -p "Object.keys(require('./package.json').scripts||{}).filter(s=>/(episode.*store|store.*episode|episode_store|memory.*(store|push|sync)|store_episode)/i.test(s)).sort().join('\n') || 'NO_MATCH'"`

## Task
Goal: store an episode to remote memory in a safe, deterministic way.

Rules:
- Do not guess. Do not print tokens. Never print env values except boolean/length.
- If STORE_EPISODE_REMOTE_URL is missing OR STORE_EPISODE_REMOTE_TOKEN length is 0:
  - STOP. Report that remote is not configured and show which variable is missing.
  - Provide the exact env var names required (no values).
- If remote is configured:
  - Prefer running an existing npm script for episode store.
  - Run: `npm run <script> -- $ARGUMENTS` if args supported, otherwise without args.
- If NO_MATCH:
  - Do NOT invent.
  - SKIP with message: "episode store script not found; run via station_cycle or add npm script".

Output:
- Whether remote config is present (bool + token length).
- What script was executed (or why it stopped).
- PASS/FAIL summary and any returned episode id / response summary (if printed by tool).
- If the tool writes evidence artifacts, point to their path.
